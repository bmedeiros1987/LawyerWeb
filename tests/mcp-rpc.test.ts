import { describe, expect, it, vi } from "vitest";
import { handleRpc, SUPPORTED_VERSIONS } from "@/lib/mcp/rpc";
import { TOOLS } from "@/lib/mcp/tools";
import { READ_ONLY_TOOLS } from "@/lib/mcp/policy";
import { allowCall, resetRateLimitForTests } from "@/lib/mcp/rate-limit";
import { parseToken } from "@/lib/mcp/tokens";

const deps = (call = vi.fn().mockResolvedValue({ text: "ok" })) => ({ tools: TOOLS, call, serverVersion: "0.2.0", instructions: "i" });
// id === null omits the field (a notification); a default parameter would turn undefined into 1.
const rpc = (method: string, params?: unknown, id: number | string | null = 1) => ({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, ...(params === undefined ? {} : { params }) });

describe("protocolo MCP", () => {
  it("initialize devolve a versão pedida (se suportada), só 'tools' e nome do servidor", async () => {
    const r = await handleRpc(rpc("initialize", { protocolVersion: "2025-03-26" }), deps());
    expect(r).toMatchObject({ status: 200, body: { id: 1, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "lawyermind" } } } });
    const unknown = await handleRpc(rpc("initialize", { protocolVersion: "1999-01-01" }), deps());
    expect((unknown as any).body.result.protocolVersion).toBe(SUPPORTED_VERSIONS[0]);
    expect((r as any).body.result.capabilities).not.toHaveProperty("resources");
  });
  it("notificações não recebem resposta; lotes e lixo são recusados", async () => {
    expect(await handleRpc(rpc("notifications/initialized", undefined, null), deps())).toEqual({ status: 202 });
    expect((await handleRpc([rpc("ping")], deps()) as any).body.error.code).toBe(-32600);
    expect((await handleRpc("x", deps()) as any).body.error.code).toBe(-32600);
    expect((await handleRpc({ jsonrpc: "1.0", id: 1, method: "ping" }, deps()) as any).body.error.code).toBe(-32600);
    expect((await handleRpc(rpc("resources/list"), deps()) as any).body.error.code).toBe(-32601);
  });
  it("tools/list: todas as ferramentas são somente leitura e estão no catálogo da política", async () => {
    const r = (await handleRpc(rpc("tools/list"), deps()) as any).body.result.tools;
    expect(r.map((t: any) => t.name).sort()).toEqual(["compare_versions", "list_documents", "read_document", "search_documents"]);
    for (const t of r) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(READ_ONLY_TOOLS.find(p => p.name === t.name)?.mutates).toBe(false);
    }
    expect(READ_ONLY_TOOLS.every(t => !t.mutates)).toBe(true);
  });
  it("tools/call: ferramenta desconhecida (inclusive de escrita) é erro de protocolo e nada é chamado", async () => {
    const call = vi.fn();
    for (const name of ["delete_document", "write_document", "documents.delete", "__proto__", ""]) {
      expect((await handleRpc(rpc("tools/call", { name, arguments: {} }), deps(call)) as any).body.error.code).toBe(-32602);
    }
    expect(call).not.toHaveBeenCalled();
  });
  it("falha interna vira mensagem genérica, sem vazar detalhes", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await handleRpc(rpc("tools/call", { name: "list_documents" }), deps(vi.fn().mockRejectedValue(new Error("SEGREDO: select * from ...")))) as any;
    expect(r.body.result.isError).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain("SEGREDO");
    spy.mockRestore();
  });
});

describe("token e limite", () => {
  it("formato do token", () => {
    expect(parseToken("lmcp_0123456789ab." + "A".repeat(43))).toEqual({ id: "0123456789ab", secret: "A".repeat(43) });
    for (const bad of ["", "lmcp_xyz", "Bearer abc", "lmcp_0123456789ab.curto", "lmcp_0123456789AB." + "A".repeat(43)]) expect(parseToken(bad)).toBeNull();
  });
  it("limite por minuto, por token", () => {
    resetRateLimitForTests();
    for (let i = 0; i < 3; i++) expect(allowCall("t1", 1000 + i, 3)).toBe(true);
    expect(allowCall("t1", 1010, 3)).toBe(false);
    expect(allowCall("t2", 1010, 3)).toBe(true);
    expect(allowCall("t1", 62_000, 3)).toBe(true);
  });
});
