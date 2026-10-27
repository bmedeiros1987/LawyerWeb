// Route contract with authorization/storage replaced by doubles; the comparison engine is real.
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ documentsMember: vi.fn(), authorizedVersionText: vi.fn(), activityCreate: vi.fn(), versionFind: vi.fn(), canAccessMatter: vi.fn() }));
vi.mock("@/lib/desktop/access", () => ({ documentsMember: m.documentsMember }));
vi.mock("@/lib/ai/document-text", () => ({ authorizedVersionText: m.authorizedVersionText }));
vi.mock("@/lib/prisma", () => ({ prisma: { activityLog: { create: m.activityCreate }, documentVersion: { findMany: m.versionFind } } }));
vi.mock("@/lib/authz/permissions", () => ({ canAccessMatter: m.canAccessMatter, P: { MATTERS_VIEW: "matters.view" } }));
vi.mock("@/lib/authz/visibility", () => ({ documentScope: () => ({}) }));
// No stored provider settings: the provider lookup reads desktop.local_setting.
vi.mock("@/lib/desktop/db", () => ({ withClient: async (fn: (c: { query: () => Promise<{ rows: never[] }> }) => unknown) => fn({ query: async () => ({ rows: [] }) }) }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/workspace/context", () => ({ getActiveMembership: vi.fn() }));
import { GET, POST } from "@/app/api/desktop/compare/route";
import { DesktopError } from "@/lib/desktop/env";

const V1 = "CLÁUSULA 1. Pagamento em R$ 10.000,00.\nCLÁUSULA 2. Prazo de 30 dias úteis.", V2 = "CLÁUSULA 1. Pagamento em R$ 12.000,00.\nCLÁUSULA 2. Prazo de 30 dias úteis.";
const doc = (id: string, text: string, version: number) => ({ documentId: "d" + id, versionId: id, text, fileSha256: "f".repeat(64), documentName: "Contrato fictício", version, originalName: `c${version}.docx` });
const post = (body: unknown, origin = "http://127.0.0.1:3000") => POST(new Request("http://127.0.0.1:3000/api/desktop/compare", { method: "POST", headers: { host: "127.0.0.1:3000", origin, "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.stubEnv("MBLZ_DESKTOP", "1"); vi.stubEnv("MBLZ_AI_PROVIDER", "");
  for (const f of Object.values(m)) f.mockReset();
  m.documentsMember.mockResolvedValue({ userId: "u1", member: { workspaceId: "w1" } });
  m.authorizedVersionText.mockImplementation(async (_u: string, _m: unknown, id: string) => (id === "v1" ? doc("v1", V1, 1) : id === "v2" ? doc("v2", V2, 2) : (() => { throw new DesktopError("Documento não encontrado.", 404); })()));
});

describe("/api/desktop/compare", () => {
  it("is 404 outside the desktop app and needs documents.view", async () => {
    vi.stubEnv("MBLZ_DESKTOP", "0");
    expect((await post({ leftVersionId: "v1", rightVersionId: "v2" })).status).toBe(404);
    expect((await GET()).status).toBe(404);
    vi.stubEnv("MBLZ_DESKTOP", "1");
    m.documentsMember.mockRejectedValue(new DesktopError("Seu perfil não tem permissão para esta ação.", 403));
    expect((await post({ leftVersionId: "v1", rightVersionId: "v2" })).status).toBe(403);
    expect(m.documentsMember).toHaveBeenCalledWith(false);
  });

  it("authorizes EACH version and compares: same member, workspace and document rules for both", async () => {
    const r = await post({ leftVersionId: "v1", rightVersionId: "v2" }), json = await r.json();
    expect(r.status).toBe(200);
    expect(m.authorizedVersionText.mock.calls.map(c => [c[0], c[2]])).toEqual([["u1", "v1"], ["u1", "v2"]]);
    expect(json.result.status).toBe("ok");
    expect(json.result.observations.find((o: { kind: string }) => o.kind === "value-changed").sources.map((s: { quote: string }) => s.quote)).toEqual(["R$ 10.000,00", "R$ 12.000,00"]);
    expect(json.left).toMatchObject({ version: 1, documentName: "Contrato fictício" }); expect(json.right.version).toBe(2);
    expect(json.ai.state).toBe("unavailable"); expect(json.sent).toMatch(/nada foi enviado/);
  });

  it("a version the member cannot open fails the whole request and nothing is compared or logged", async () => {
    const r = await post({ leftVersionId: "v1", rightVersionId: "secreto" });
    expect(r.status).toBe(404); expect(m.activityCreate).not.toHaveBeenCalled();
    expect((await post({ leftVersionId: "secreto", rightVersionId: "v1" })).status).toBe(404);
  });

  it("audit keeps ids, hashes and counts, never the text", async () => {
    await post({ leftVersionId: "v1", rightVersionId: "v2" });
    const logged = JSON.stringify(m.activityCreate.mock.calls[0][0]);
    expect(logged).toContain("DOCUMENT_COMPARED"); expect(logged).toContain("leftSha256");
    expect(logged).not.toContain("Pagamento"); expect(logged).not.toContain("10.000");
  });

  it("an oversized document answers with an honest message and writes no audit", async () => {
    m.authorizedVersionText.mockImplementation(async (_u: string, _m: unknown, id: string) => doc(id, "x".repeat(400_001), 1));
    const json = await (await post({ leftVersionId: "v1", rightVersionId: "v2" })).json();
    expect(json.result).toMatchObject({ status: "too-large" }); expect(json.result.message).toMatch(/Compare por partes/);
    expect(m.activityCreate).not.toHaveBeenCalled();
  });

  it("strict body and same-origin only", async () => {
    expect((await post({ leftVersionId: "v1" })).status).toBe(400);
    expect((await post({ leftVersionId: "v1", rightVersionId: "v2", text: "x" })).status).toBe(400);
    expect((await post({ leftVersionId: "v1", rightVersionId: "v2" }, "http://evil.test")).status).toBe(403);
  });

  it("the version list hides versions of confidential matters the member cannot open", async () => {
    m.versionFind.mockResolvedValue([
      { id: "a", version: 1, originalName: "a.docx", document: { id: "d1", name: "Aberto", matterId: null } },
      { id: "b", version: 2, originalName: null, document: { id: "d2", name: "Sigiloso", matterId: "m-secret" } },
      { id: "c", version: 1, originalName: "c.pdf", document: { id: "d3", name: "Visível", matterId: "m-ok" } },
    ]);
    m.canAccessMatter.mockImplementation(async (_u: string, _w: string, matter: string) => matter === "m-ok");
    const json = await (await GET()).json();
    expect(json.versions.map((v: { id: string }) => v.id)).toEqual(["a", "c"]);
    expect(JSON.stringify(json)).not.toContain("Sigiloso");
  });
});
