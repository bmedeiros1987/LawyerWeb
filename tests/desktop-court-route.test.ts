import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  auth: vi.fn(), member: vi.fn(), permissionMember: vi.fn(), matter: vi.fn(),
  state: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: mock.auth }));
vi.mock("@/lib/workspace/context", () => ({ getActiveMembership: mock.member }));
// Keep PR60's authorization implementation real, including ordinary Error(status=403).
vi.mock("@/lib/prisma", () => ({ prisma: {
  workspaceMember: { findUnique: mock.permissionMember }, matter: { findFirst: mock.matter },
} }));
vi.mock("@/lib/desktop/court-store", () => ({
  courtState: mock.state, courtStore: { transaction: mock.transaction },
}));
import { GET, POST } from "@/app/api/desktop/courts/[id]/route";
const member = { id: "fixture-member", userId: "fixture-user", workspaceId: "fixture-workspace",
  status: "ACTIVE", role: { permissions: { allow: ["matters.view"] } } };
const context = () => ({ params: Promise.resolve({ id: "unavailable-process" }) });
const request = () => new Request("http://127.0.0.1:5544/api/desktop/courts/unavailable-process", {
  method: "POST", headers: { host: "127.0.0.1:5544", origin: "http://127.0.0.1:5544", "content-type": "application/json" },
  body: JSON.stringify({ source: "DATAJUD" }),
});
beforeEach(() => {
  vi.resetAllMocks(); process.env.MBLZ_DESKTOP = "1";
  mock.auth.mockResolvedValue({ user: { id: member.userId } });
  mock.member.mockResolvedValue(member); mock.permissionMember.mockResolvedValue(member);
  mock.matter.mockResolvedValue({ secrecy: false });
});
describe("court route authorization with real PR60 permission checks", () => {
  it.each(["GET", "POST"])("%s denies an active member without matters.view as generic 404, never 500", async method => {
    const denied = { ...member, role: { permissions: { allow: [] } } };
    mock.member.mockResolvedValue(denied); mock.permissionMember.mockResolvedValue(denied);
    const response = method === "GET" ? await GET(new Request("http://127.0.0.1:5544"), context()) : await POST(request(), context());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Processo não encontrado." });
    expect(mock.state).not.toHaveBeenCalled(); expect(mock.transaction).not.toHaveBeenCalled();
  });
  it.each(["GET", "POST"])("%s translates ordinary authorization Error(403) after permission revocation", async method => {
    mock.permissionMember.mockResolvedValueOnce(member).mockResolvedValueOnce(null);
    const response = method === "GET" ? await GET(new Request("http://127.0.0.1:5544"), context()) : await POST(request(), context());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Processo não encontrado." });
    expect(mock.state).not.toHaveBeenCalled(); expect(mock.transaction).not.toHaveBeenCalled();
  });
  it("POST rejects cross-origin requests before authorization or provider work", async () => {
    const response = await POST(new Request("http://127.0.0.1:5544", { method: "POST",
      headers: { host: "127.0.0.1:5544", origin: "https://untrusted.invalid", "content-type": "application/json" }, body: "{}" }), context());
    expect(response.status).toBe(403); expect(mock.auth).not.toHaveBeenCalled();
    expect(mock.transaction).not.toHaveBeenCalled();
  });
});
