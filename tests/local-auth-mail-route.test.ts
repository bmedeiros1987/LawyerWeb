import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ callbacks: [] as (() => Promise<void>)[], queue: vi.fn(async () => "synthetic-job"), deliver: vi.fn(async () => {}), mail: vi.fn() }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: (callback: () => Promise<void>) => state.callbacks.push(callback) }));
vi.mock("@/lib/local-auth/outbox", () => ({ queueAuthMail: state.queue, deliverAuthJob: state.deliver }));
vi.mock("@/lib/local-auth/service", () => ({ finishChallenge: vi.fn(), passwordLogin: vi.fn(), revokeBrowserSessions: vi.fn(), SESSION_SECONDS: 604800 }));
vi.mock("@/lib/local-auth/mail", () => ({ localAuthEnabled: () => true, configuredMailer: () => state.mail }));
import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/local/[action]/route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); state.callbacks.length = 0; });
it("responds after durable queueing, with no SMTP on the public request path", async () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
  for (const action of ["register", "reset"]) {
    const response = await POST(new NextRequest(`https://app.example.invalid/api/auth/local/${action}`, { method: "POST", headers: { origin: "https://app.example.invalid", "content-type": "application/json" }, body: JSON.stringify({ email: "synthetic@example.invalid" }) }), { params: Promise.resolve({ action }) });
    expect(response.status).toBe(202); expect(state.deliver).not.toHaveBeenCalled(); expect(state.mail).not.toHaveBeenCalled();
  }
  expect(state.queue).toHaveBeenCalledTimes(2); expect(state.callbacks).toHaveLength(2);
  await state.callbacks[0](); expect(state.deliver).toHaveBeenCalledWith("synthetic-job", state.mail);
});
