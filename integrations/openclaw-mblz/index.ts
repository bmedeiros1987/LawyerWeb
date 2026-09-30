import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

type Binding = { agentToken: string };

function baseUrl(): string {
  const raw = String(process.env.MBLZ_API_BASE_URL || "").trim();
  if (!raw) throw new Error("MBLZ_API_BASE_URL is not configured");
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("MBLZ_API_BASE_URL must use http(s)");
  return url.toString().replace(/\/$/, "");
}

function bindings(): Record<string, Binding> {
  const raw = String(process.env.MBLZ_OPENCLAW_BINDINGS_JSON || "").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, Binding> = {};
  for (const [sender, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const agentToken = String((value as Record<string, unknown>).agentToken || "").trim();
    if (sender.trim() && agentToken) out[sender.trim()] = { agentToken };
  }
  return out;
}

function bindingFor(requesterSenderId: unknown): Binding | null {
  const sender = String(requesterSenderId || "").trim();
  return sender ? bindings()[sender] || null : null;
}

async function readJson(path: string, binding: Binding) {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "GET",
    headers: { authorization: `Bearer ${binding.agentToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error?: unknown }).error || "MBLZ agent request failed")
      : "MBLZ agent request failed";
    return { ok: false as const, status: response.status, message };
  }
  return { ok: true as const, payload };
}

function unlinked() {
  return {
    content: [{ type: "text" as const, text: "MBLZ account not linked for this sender. Connect this channel from your authenticated MBLZ workspace first." }],
    details: { ok: false, linked: false },
  };
}

export default definePluginEntry({
  id: "mblz-agent",
  name: "MBLZ Agent",
  description: "Read-only MBLZ tools bound to a trusted OpenClaw requester.",
  register(api) {
    api.registerTool(
      (toolContext) => ({
        name: "mblz_workspace_summary",
        description: "Read a compact summary of the linked MBLZ workspace. Identity and workspace are derived from the sender-bound agent credential, never from model parameters.",
        parameters: Type.Object({}),
        async execute() {
          const binding = bindingFor(toolContext.requesterSenderId);
          if (!binding) return unlinked();
          const result = await readJson("/api/agent/summary", binding);
          return {
            content: [{ type: "text", text: result.ok ? JSON.stringify(result.payload) : result.message }],
            details: result,
          };
        },
      }),
      { name: "mblz_workspace_summary", optional: true },
    );

    api.registerTool(
      (toolContext) => ({
        name: "mblz_upcoming_deadlines",
        description: "List upcoming confirmed/in-progress deadlines visible to the linked MBLZ member. Existing workspace, role and secrecy ACLs are rechecked by MBLZ.",
        parameters: Type.Object({
          days: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
        }),
        async execute(_toolCallId, params) {
          const binding = bindingFor(toolContext.requesterSenderId);
          if (!binding) return unlinked();
          const days = Math.min(30, Math.max(1, Number(params.days || 14)));
          const result = await readJson(`/api/agent/deadlines?days=${encodeURIComponent(days)}`, binding);
          return {
            content: [{ type: "text", text: result.ok ? JSON.stringify(result.payload) : result.message }],
            details: result,
          };
        },
      }),
      { name: "mblz_upcoming_deadlines", optional: true },
    );
  },
});
