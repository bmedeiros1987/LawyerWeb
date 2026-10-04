import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashPassword, newToken, tokenHash, verifyPassword } from "@/lib/local-auth/crypto";
import { authBody, authFailure, beginInput, finishInput } from "@/lib/local-auth/http";
import { configuredMailer } from "@/lib/local-auth/mail";

afterEach(() => vi.unstubAllEnvs());
describe("local password and request boundaries", () => {
  it("salts password hashes and verifies without accepting malformed hashes", async () => {
    const hash = await hashPassword("synthetic password only");
    expect(hash).not.toContain("synthetic");
    expect(await verifyPassword("synthetic password only", hash)).toBe(true);
    expect(await verifyPassword("different password only", hash)).toBe(false);
    expect(await verifyPassword("synthetic password only", null)).toBe(false);
    expect(await verifyPassword("synthetic password only", "bad")).toBe(false);
    expect(await hashPassword("synthetic password only")).not.toBe(hash);
    await expect(hashPassword("short")).rejects.toMatchObject({ status: 400 });
    expect(await verifyPassword("x".repeat(129), hash)).toBe(false);
  }, 15_000);
  it("bounds concurrent KDF work instead of queueing unlimited passwords", async () => {
    const work = [hashPassword("synthetic password one"), hashPassword("synthetic password two")];
    await expect(hashPassword("synthetic password three")).rejects.toMatchObject({ status: 503 });
    await Promise.all(work);
  });
  it("stores only digests of high-entropy tokens", () => {
    const token = newToken(); expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(tokenHash(token)).toHaveLength(64); expect(newToken()).not.toBe(token);
  });
  it("rejects a password at preregistration and mismatched confirmation", () => {
    expect(beginInput.safeParse({ email: "test@example.invalid", password: "attacker chosen password" }).success).toBe(false);
    expect(beginInput.parse({ email: " Test@Example.invalid " }).email).toBe("test@example.invalid");
    expect(finishInput.safeParse({ token: newToken(), purpose: "REGISTER", password: "synthetic password", passwordConfirmation: "different password" }).success).toBe(false);
  });
  it("requires enabled auth, canonical origin, JSON and a bounded body", async () => {
    vi.stubEnv("AUTH_LOCAL_ENABLED", "true"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
    const request = (origin: string, body = "{}", type = "application/json") => new NextRequest("https://app.example.invalid/api/auth/local/login", { method: "POST", headers: { origin, "content-type": type }, body });
    expect(await authBody(request("https://app.example.invalid"))).toEqual({});
    await expect(authBody(request("https://attacker.example.invalid"))).rejects.toMatchObject({ status: 403 });
    await expect(authBody(request("", "{}"))).rejects.toMatchObject({ status: 403 });
    await expect(authBody(request("https://app.example.invalid", "{}", "text/plain"))).rejects.toMatchObject({ status: 415 });
    await expect(authBody(request("https://app.example.invalid", "x".repeat(16385)))).rejects.toMatchObject({ status: 413 });
    await expect(authBody(request("https://app.example.invalid", "not json"))).rejects.toMatchObject({ status: 400 });
    vi.stubEnv("AUTH_LOCAL_ENABLED", "false"); await expect(authBody(request("https://app.example.invalid"))).rejects.toMatchObject({ status: 503 });
  });
  it("does not expose database or mail internals and fails closed without SMTP", async () => {
    const response = authFailure(new Error("private connection detail"));
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private"); expect(response.headers.get("cache-control")).toBe("no-store");
    vi.stubEnv("AUTH_SMTP_HOST", ""); expect(configuredMailer).toThrow();
  });
});
