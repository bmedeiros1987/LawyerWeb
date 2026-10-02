import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), delete: vi.fn(), sendNotification: vi.fn(), setVapidDetails: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { pushSubscription: mocks } }));
vi.mock("web-push", () => ({ default: mocks }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: Math.random().toString() } }) }));
import { sendPushToUser, InvalidVapidConfigurationError } from "@/lib/push/webpush";
import { POST } from "@/app/api/push/test/route";
beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "fake"; process.env.VAPID_PRIVATE_KEY = "fake"; process.env.VAPID_SUBJECT = "mailto:test@example.invalid";
  mocks.findMany.mockResolvedValue([{ endpoint: "https://push.invalid/test", p256dh: "fake", auth: "fake" }]);
});
describe("push diagnostics without network or database", () => {
  it("counts only confirmed removals", async () => {
    mocks.sendNotification.mockRejectedValue({ statusCode: 410 }); mocks.delete.mockRejectedValue(new Error("DB unavailable"));
    expect(await sendPushToUser("test", { title: "test" })).toMatchObject({ removed: 0, failed: 1, sent: 0 });
    mocks.delete.mockResolvedValue({});
    expect(await sendPushToUser("test", { title: "test" })).toMatchObject({ removed: 1, failed: 0 });
  });
  it("invalid VAPID never queries subscriptions or sends", async () => {
    mocks.setVapidDetails.mockImplementation(() => { throw new Error("private detail"); });
    await expect(sendPushToUser("test", { title: "test" })).rejects.toBeInstanceOf(InvalidVapidConfigurationError);
    const response = await POST(); expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ reason: "VAPID_INVALID", vapidConfigured: false });
    expect(mocks.findMany).not.toHaveBeenCalled(); expect(mocks.sendNotification).not.toHaveBeenCalled();
  });
  it("keeps query failures distinct", async () => {
    mocks.findMany.mockRejectedValue(new Error("DB unavailable"));
    const response = await POST(); expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Falha ao consultar as assinaturas de push." });
  });
  it("reports missing configuration, missing subscriptions and acceptance separately", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    expect(await sendPushToUser("test", { title: "test" })).toMatchObject({ reason: "VAPID_NOT_CONFIGURED", sent: 0 });
    process.env.VAPID_PRIVATE_KEY = "fake"; mocks.findMany.mockResolvedValue([]);
    expect(await sendPushToUser("test", { title: "test" })).toMatchObject({ reason: "NO_SUBSCRIPTIONS", sent: 0 });
    mocks.findMany.mockResolvedValue([{ endpoint: "https://push.invalid/test" }]); mocks.sendNotification.mockResolvedValue({ statusCode: 201 });
    const response = await POST(); const body = await response.json();
    expect(body.accepted).toBe(1); expect(body.note).toContain("exibição no aparelho"); expect(body.delivered).toBeUndefined();
  });
});
