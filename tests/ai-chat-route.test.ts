// Route contract with the authorization and storage layers replaced by doubles (no database, no network).
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  documentsMember: vi.fn(), authorizedVersionText: vi.fn(), activityCreate: vi.fn(), auth: vi.fn(),
}));
vi.mock("@/lib/desktop/access", () => ({ documentsMember: m.documentsMember }));
vi.mock("@/lib/ai/document-text", () => ({ authorizedVersionText: m.authorizedVersionText }));
vi.mock("@/lib/prisma", () => ({ prisma: { activityLog: { create: m.activityCreate } } }));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/workspace/context", () => ({ getActiveMembership: vi.fn() }));
import { GET, POST } from "@/app/api/desktop/ai-chat/route";
import { clearProvidersForTests, registerProvider } from "@/lib/ai/provider";

const text = "CLÁUSULA 2. A rescisão exige aviso de 10 dias.";
const post = (body: unknown, origin = "http://127.0.0.1:3000") => POST(new Request("http://127.0.0.1:3000/api/desktop/ai-chat", { method: "POST", headers: { host: "127.0.0.1:3000", origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
const body = { versionId: "v1", start: 0, end: 20, question: "O que diz?", consent: true };

beforeEach(() => {
  vi.stubEnv("MBLZ_DESKTOP", "1"); vi.stubEnv("MBLZ_AI_PROVIDER", "");
  for (const f of Object.values(m)) f.mockReset();
  m.documentsMember.mockResolvedValue({ userId: "u1", member: { workspaceId: "w1" } });
  m.authorizedVersionText.mockResolvedValue({ documentId: "d1", versionId: "v1", text, fileSha256: "h" });
  clearProvidersForTests();
});

describe("/api/desktop/ai-chat", () => {
  it("is 404 outside the desktop app", async () => {
    vi.stubEnv("MBLZ_DESKTOP", "0");
    expect((await GET(new Request("http://127.0.0.1:3000/api/desktop/ai-chat"))).status).toBe(404);
    expect((await post(body)).status).toBe(404);
    expect(m.documentsMember).not.toHaveBeenCalled();
  });

  it("answers 503 unavailable with no provider, without logging and without exposing anything", async () => {
    const r = await post(body), json = await r.json();
    expect(r.status).toBe(503);
    expect(json).toMatchObject({ status: "unavailable", code: "provider-unavailable", provider: { state: "unavailable", sendsDataOutsideDevice: false } });
    expect(m.documentsMember).toHaveBeenCalledWith(false); // view permission is enough; no edit right implied
    expect(m.activityCreate).not.toHaveBeenCalled();
  });

  it("requires consent, a same-origin request and a strict body", async () => {
    expect((await post({ ...body, consent: false })).status).toBe(400);
    expect((await post({ ...body, extra: 1 })).status).toBe(400);
    expect((await post(body, "http://evil.test")).status).toBe(403);
    expect(m.authorizedVersionText).not.toHaveBeenCalled();
  });

  it("propagates an authorization refusal and never reaches the provider", async () => {
    const complete = vi.fn(); registerProvider("dbl", () => ({ status: () => ({ id: "dbl", label: "d", state: "available", reason: "ok", sendsDataOutsideDevice: true }), complete }));
    vi.stubEnv("MBLZ_AI_PROVIDER", "dbl");
    m.documentsMember.mockRejectedValue(Object.assign(new Error("x"), { status: 403 }));
    expect((await post(body)).status).toBe(500); // unknown errors are generic, never a leak
    const { DesktopError } = await import("@/lib/desktop/env");
    m.documentsMember.mockRejectedValue(new DesktopError("Seu perfil não tem permissão para esta ação.", 403));
    expect((await post(body)).status).toBe(403);
    expect(complete).not.toHaveBeenCalled();
  });

  it("with an adapter, logs metadata only and returns the validated answer", async () => {
    const complete = vi.fn().mockResolvedValue({ answer: "Exige aviso.", citations: [{ quote: "A rescisão" }], suggestions: [], uncertainty: { level: "low", notes: [] } });
    registerProvider("dbl", () => ({ status: () => ({ id: "dbl", label: "d", state: "available", reason: "ok", sendsDataOutsideDevice: true }), complete }));
    vi.stubEnv("MBLZ_AI_PROVIDER", "dbl");
    const r = await post({ ...body, start: 12, end: 40, question: "Pergunta confidencial" }), json = await r.json();
    expect(r.status).toBe(200);
    expect(json.sources.verified[0]).toMatchObject({ quote: "A rescisão", start: 12, end: 22 });
    expect(complete.mock.calls[0][0].context.excerpt).toBe(text.slice(12, 40));
    const logged = JSON.stringify(m.activityCreate.mock.calls[0][0]);
    expect(logged).toContain("AI_CHAT_ASKED"); expect(logged).not.toContain("Pergunta confidencial"); expect(logged).not.toContain("rescisão");
  });

  it("rejects an out-of-range selection with 400 before calling the provider", async () => {
    const complete = vi.fn(); registerProvider("dbl", () => ({ status: () => ({ id: "dbl", label: "d", state: "available", reason: "ok", sendsDataOutsideDevice: true }), complete }));
    vi.stubEnv("MBLZ_AI_PROVIDER", "dbl");
    expect((await post({ ...body, end: 9999 })).status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });
});
