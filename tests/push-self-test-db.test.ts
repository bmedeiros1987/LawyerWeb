import { guardedDatabaseLifecycle } from "./helpers/disposable-db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const session = vi.hoisted(() => ({ user: { id: "" } as { id: string } | undefined }));
const wp = vi.hoisted(() => ({ setVapidDetails: vi.fn(), sendNotification: vi.fn() }));
vi.mock("@/auth", () => ({ auth: async () => (session.user ? { user: session.user } : null) }));
vi.mock("web-push", () => ({ default: wp }));

import { prisma } from "@/lib/prisma";
import { POST as selfTest } from "@/app/api/push/test/route";

const users: string[] = [];
const vapid = (on: boolean) => {
  if (on) { process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "fake-public"; process.env.VAPID_PRIVATE_KEY = "fake-private"; process.env.VAPID_SUBJECT = "mailto:test@example.invalid"; }
  else { delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT; }
};
async function user() {
  const u = await prisma.user.create({ data: { name: `selftest-${randomUUID()}` } });
  users.push(u.id);
  return u.id;
}

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("Push self-test endpoint (device proof helper)", () => {
  const dbLifecycle = guardedDatabaseLifecycle();
  beforeAll(() => dbLifecycle.setup(async () => {}));
  beforeEach(() => { wp.sendNotification.mockReset(); wp.setVapidDetails.mockReset(); vapid(false); });
  afterAll(() => dbLifecycle.cleanup(async () => {
    try { await prisma.user.deleteMany({ where: { id: { in: users } } }); }
    finally { await prisma.$disconnect(); }
  }));

  it("requires a session", async () => {
    session.user = undefined;
    expect((await selfTest()).status).toBe(401);
    expect(wp.sendNotification).not.toHaveBeenCalled();
  });

  it("reports missing VAPID configuration instead of pretending to send", async () => {
    session.user = { id: await user() };
    const body = await (await selfTest()).json();
    expect(body).toMatchObject({ vapidConfigured: false, reason: "VAPID_NOT_CONFIGURED", accepted: 0 });
    expect(wp.sendNotification).not.toHaveBeenCalled();
  });

  it("reports a user without registered devices", async () => {
    session.user = { id: await user() }; vapid(true);
    expect(await (await selfTest()).json()).toMatchObject({ vapidConfigured: true, reason: "NO_SUBSCRIPTIONS", subscriptions: 0, accepted: 0 });
  });

  it("sends only to the caller's own subscriptions, with a generic payload, and reports the push service answer", async () => {
    const me = await user(), other = await user();
    session.user = { id: me }; vapid(true);
    await prisma.pushSubscription.create({ data: { userId: me, endpoint: `https://push.invalid/me-${randomUUID()}`, p256dh: "k", auth: "a" } });
    const theirs = await prisma.pushSubscription.create({ data: { userId: other, endpoint: `https://push.invalid/other-${randomUUID()}`, p256dh: "k", auth: "a" } });
    wp.sendNotification.mockResolvedValue({ statusCode: 201 });
    const body = await (await selfTest()).json();
    expect(body).toMatchObject({ subscriptions: 1, accepted: 1, failed: 0, removed: 0 });
    expect(wp.sendNotification).toHaveBeenCalledTimes(1);
    expect(wp.sendNotification.mock.calls[0][0].endpoint).not.toBe(theirs.endpoint);
    expect(String(wp.sendNotification.mock.calls[0][1])).toContain("teste de notificação");
  });

  it("surfaces push-service rejection and is rate-limited per user", async () => {
    const me = await user();
    session.user = { id: me }; vapid(true);
    await prisma.pushSubscription.create({ data: { userId: me, endpoint: `https://push.invalid/rej-${randomUUID()}`, p256dh: "k", auth: "a" } });
    wp.sendNotification.mockRejectedValue(Object.assign(new Error("Forbidden"), { statusCode: 403 }));
    const first = await selfTest();
    expect(await first.json()).toMatchObject({ accepted: 0, failed: 1, failureStatusCodes: [403] });
    expect((await selfTest()).status).toBe(429);
  });
});
