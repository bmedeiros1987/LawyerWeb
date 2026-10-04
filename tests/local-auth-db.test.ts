import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import * as crypto from "@/lib/local-auth/crypto";
import { beginChallenge, finishChallenge, passwordLogin, readLocalSession, rateLimit } from "@/lib/local-auth/service";
import { POST } from "@/app/api/auth/local/[action]/route";
import type { AuthMail, Purpose } from "@/lib/local-auth/mail";

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("local auth with isolated PostgreSQL and fake mail only", () => {
  const ids: string[] = [], emails: string[] = [];
  const password = "synthetic password only", replacement = "synthetic replacement only";
  const email = () => { const value = `synthetic-${randomUUID()}@example.invalid`; emails.push(value); return value; };
  async function challenge(address: string, purpose: Purpose = "REGISTER") {
    const captured: AuthMail[] = [];
    await beginChallenge(address, purpose, async message => { captured.push(message); });
    expect(captured).toHaveLength(1); return captured[0];
  }
  async function register() {
    const address = email(), link = await challenge(address);
    const result = await finishChallenge({ ...link, password, name: "Synthetic User" }); ids.push(result.userId);
    return { address, userId: result.userId };
  }
  beforeAll(() => { vi.stubEnv("AUTH_LOCAL_ENABLED", "true"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000"); });
  beforeEach(async () => { await prisma.localAuthRateLimit.deleteMany(); });
  afterAll(async () => {
    await prisma.localAuthChallenge.deleteMany({ where: { email: { in: emails } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.localAuthRateLimit.deleteMany(); vi.unstubAllEnvs(); await prisma.$disconnect();
  });
  it("P1 preregistration cannot activate a password or claim an existing Google/invited account", async () => {
    const address = email();
    const user = await prisma.user.create({ data: { email: address, name: "Existing synthetic invite" } }); ids.push(user.id);
    const mail = vi.fn(); await beginChallenge(address, "REGISTER", mail); await beginChallenge(address, "RESET", mail);
    expect(mail).not.toHaveBeenCalled(); expect(await prisma.localCredential.findUnique({ where: { userId: user.id } })).toBeNull();
    await expect(passwordLogin(address, password)).rejects.toMatchObject({ status: 401 });
    const token = crypto.newToken(); await prisma.localAuthChallenge.create({ data: { id: randomUUID(), email: address, purpose: "REGISTER", tokenHash: crypto.tokenHash(token), expiresAt: new Date(Date.now() + 60000) } });
    await expect(finishChallenge({ token, purpose: "REGISTER", password, name: "Attacker" })).rejects.toMatchObject({ status: 400 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe("Existing synthetic invite");
  });
  it("verifies before choosing a password; consumes a scalar-locked token once across concurrent retries", async () => {
    const address = email(), link = await challenge(address);
    expect(await prisma.user.findUnique({ where: { email: address } })).toBeNull();
    const stored = await prisma.localAuthChallenge.findUniqueOrThrow({ where: { tokenHash: crypto.tokenHash(link.token) } });
    expect(JSON.stringify(stored)).not.toContain(link.token); expect(JSON.stringify(stored)).not.toContain(password);
    const results = await Promise.allSettled([1, 2].map(() => finishChallenge({ ...link, password, name: "Synthetic verified" })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const winner = results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<{ userId: string }>; ids.push(winner.value.userId);
    expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.status).toBe(400);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: winner.value.userId } }); expect(user.emailVerified).toBeTruthy();
    expect(await prisma.workspaceMember.count({ where: { userId: user.id } })).toBe(0);
    // P1 regression: Prisma can deserialize scalar FOR UPDATE results; no PostgreSQL void returned.
    const logged = await passwordLogin(address, password); expect((await readLocalSession(logged.token))?.user.id).toBe(user.id);
  });
  it("rejects expired/purpose-swapped tokens and invalidates an older verification link", async () => {
    const address = email(), first = await challenge(address), second = await challenge(address);
    await expect(finishChallenge({ ...first, password, name: "Synthetic" })).rejects.toMatchObject({ status: 400 });
    await expect(finishChallenge({ ...second, purpose: "RESET", password })).rejects.toMatchObject({ status: 400 });
    await prisma.localAuthChallenge.update({ where: { tokenHash: crypto.tokenHash(second.token) }, data: { expiresAt: new Date(0) } });
    await expect(finishChallenge({ ...second, password, name: "Synthetic" })).rejects.toMatchObject({ status: 400 });
  });
  it("enforces casefold uniqueness against concurrent account creation", async () => {
    const address = email(); const user = await prisma.user.create({ data: { email: address.toUpperCase() } }); ids.push(user.id);
    await expect(prisma.user.create({ data: { email: ` ${address} ` } })).rejects.toMatchObject({ code: "P2002" });
    const mail = vi.fn(); await beginChallenge(address, "REGISTER", mail); expect(mail).not.toHaveBeenCalled();
  });
  it("reset revokes local and Google sessions, and login rotates an incoming local session", async () => {
    const { address, userId } = await register();
    const first = await passwordLogin(address, password), second = await passwordLogin(address, password, first.token);
    expect(await readLocalSession(first.token)).toBeNull(); expect((await readLocalSession(second.token))?.user.id).toBe(userId);
    const googleToken = randomUUID(); await prisma.session.create({ data: { sessionToken: googleToken, userId, expires: new Date(Date.now() + 60000) } });
    const reset = await challenge(address, "RESET"); await finishChallenge({ ...reset, password: replacement });
    expect(await readLocalSession(second.token)).toBeNull(); expect(await prisma.session.count({ where: { userId } })).toBe(0);
    await expect(passwordLogin(address, password)).rejects.toMatchObject({ status: 401 });
    expect((await readLocalSession((await passwordLogin(address, replacement)).token))?.user.id).toBe(userId);
  });
  it("a reset racing a verified login cannot issue a session using the old password", async () => {
    const { address } = await register(), reset = await challenge(address, "RESET");
    const original = crypto.verifyPassword;
    let verified!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { verified = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(crypto, "verifyPassword").mockImplementationOnce(async (...args) => { const result = await original(...args); verified(); await gate; return result; });
    const login = passwordLogin(address, password); const assertion = expect(login).rejects.toMatchObject({ status: 401 });
    try { await ready; await finishChallenge({ ...reset, password: replacement }); } finally { release(); }
    await assertion; spy.mockRestore();
  });
  it("logout revokes both identities and clears both provider cookies", async () => {
    const local = await register(), other = await register(), session = await passwordLogin(local.address, password), google = randomUUID();
    await prisma.session.create({ data: { userId: other.userId, sessionToken: google, expires: new Date(Date.now() + 60000) } });
    const response = await POST(new NextRequest("http://localhost:3000/api/auth/local/logout", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", cookie: `lawyermind.session=${session.token}; authjs.session-token=${google}` }, body: "{}" }), { params: Promise.resolve({ action: "logout" }) });
    expect(response.status).toBe(200); expect(await readLocalSession(session.token)).toBeNull(); expect(await prisma.session.findUnique({ where: { sessionToken: google } })).toBeNull();
    expect(response.cookies.get("lawyermind.session")?.value).toBe(""); expect(response.cookies.get("authjs.session-token")?.value).toBe("");
  });
  it("rejects expired or disabled local sessions and enforces persistent rate limits", async () => {
    const { address } = await register(), session = await passwordLogin(address, password);
    vi.stubEnv("AUTH_LOCAL_ENABLED", "false"); expect(await readLocalSession(session.token)).toBeNull(); vi.stubEnv("AUTH_LOCAL_ENABLED", "true");
    await prisma.localSession.update({ where: { tokenHash: crypto.tokenHash(session.token) }, data: { expiresAt: new Date(0) } }); expect(await readLocalSession(session.token)).toBeNull();
    await rateLimit("synthetic", address, 1, 900); await expect(rateLimit("synthetic", address, 1, 900)).rejects.toMatchObject({ status: 429 });
  });
});
