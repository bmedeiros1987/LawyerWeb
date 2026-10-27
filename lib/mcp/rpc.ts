// Minimal MCP (JSON-RPC 2.0) server core: initialize, ping, tools/list, tools/call. Tools only; no
// resources, prompts, sampling or notifications to the client. Transport lives elsewhere.
export const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export type ToolDef = {
  name: string; title: string; description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  annotations: { readOnlyHint: true; destructiveHint: false; idempotentHint: true; openWorldHint: false };
};
export type ToolOutput = { text: string; isError?: boolean };
export type RpcDeps = { tools: readonly ToolDef[]; call: (name: string, args: unknown) => Promise<ToolOutput>; serverVersion: string; instructions: string };
export type RpcReply = { status: 200; body: Record<string, unknown> } | { status: 202 };

const err = (id: unknown, code: number, message: string): RpcReply => ({ status: 200, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } });
const ok = (id: unknown, result: unknown): RpcReply => ({ status: 200, body: { jsonrpc: "2.0", id, result } });

export async function handleRpc(message: unknown, deps: RpcDeps): Promise<RpcReply> {
  if (!message || typeof message !== "object" || Array.isArray(message)) return err(null, -32600, "Requisição inválida (lotes não são aceitos).");
  const m = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return err(m.id, -32600, "Requisição inválida.");
  const isNotification = m.id === undefined;
  if (isNotification) return { status: 202 }; // notifications (e.g. notifications/initialized) need no answer
  if (typeof m.id !== "string" && typeof m.id !== "number") return err(null, -32600, "Identificador inválido.");
  const params = (m.params && typeof m.params === "object" ? m.params : {}) as Record<string, unknown>;

  switch (m.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (SUPPORTED_VERSIONS as readonly string[]).includes(asked) ? asked : SUPPORTED_VERSIONS[0];
      return ok(m.id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "lawyermind", title: "LawyerMind (somente leitura)", version: deps.serverVersion }, instructions: deps.instructions });
    }
    case "ping": return ok(m.id, {});
    case "tools/list": return ok(m.id, { tools: deps.tools });
    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string" || !deps.tools.some(t => t.name === name)) return err(m.id, -32602, "Ferramenta desconhecida.");
      try {
        const out = await deps.call(name, params.arguments ?? {});
        return ok(m.id, { content: [{ type: "text", text: out.text }], isError: out.isError === true });
      } catch (e) {
        // Never echo internals: a generic failure the model can report, not retry blindly.
        console.error("[mcp]", e instanceof Error ? e.message : e);
        return ok(m.id, { content: [{ type: "text", text: "Não foi possível concluir a consulta." }], isError: true });
      }
    }
    default: return err(m.id, -32601, "Método não suportado.");
  }
}
