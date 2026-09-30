import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const allowedChannels = new Set(["WHATSAPP", "TELEGRAM"]);

function bridgeConfig() {
  return {
    apiUrl: String(process.env.MBLZ_INTERNAL_API_URL ?? "").replace(/\/$/, ""),
    serviceToken: String(process.env.MBLZ_AGENT_SERVICE_TOKEN ?? "")
  };
}

function runtimeIdentity(toolContext) {
  const delivery = toolContext?.deliveryContext ?? {};
  const channel = String(delivery.channel ?? "").toUpperCase();
  const accountId = String(delivery.accountId ?? "");
  const senderId = String(toolContext?.requesterSenderId ?? "");
  if (!allowedChannels.has(channel) || !accountId || !senderId) return null;
  return { channel, accountId, senderId };
}

async function postBridge(path, identity, payload = {}) {
  const { apiUrl, serviceToken } = bridgeConfig();
  if (!apiUrl || !serviceToken) throw new Error("MBLZ context bridge is not configured.");
  const response = await fetch(apiUrl + path, {
    method: "POST",
    headers: {
      authorization: "Bearer " + serviceToken,
      "content-type": "application/json"
    },
    body: JSON.stringify({ ...identity, ...payload }),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) throw new Error(data?.error || "MBLZ denied this request.");
  return data;
}

export default definePluginEntry({
  id: "mblz",
  name: "MBLZ Legal OS",
  description: "Identity-bound sender pairing and read-only context from MBLZ.",
  register(api) {
    api.registerTool(
      (toolContext) => ({
        name: "mblz_pair",
        description: "Bind the current Telegram/WhatsApp sender to a prepared MBLZ Agent channel using the short-lived pairing code shown in MBLZ Integrations. Never ask for a password, API token or secret.",
        parameters: Type.Object({
          code: Type.String({ minLength: 8, maxLength: 32 })
        }),
        async execute(_id, params) {
          const identity = runtimeIdentity(toolContext);
          if (!identity) {
            return { content: [{ type: "text", text: "This conversation has no trusted external channel sender identity, so MBLZ pairing cannot run here." }] };
          }
          try {
            const result = await postBridge("/api/internal/openclaw/pair", identity, { code: String(params.code).trim().toUpperCase() });
            return {
              content: [{ type: "text", text: result.alreadyPaired ? "Este remetente já está vinculado ao MBLZ." : "Canal vinculado ao MBLZ com sucesso. Agora posso consultar apenas o seu contexto autorizado." }]
            };
          } catch (error) {
            return { content: [{ type: "text", text: error instanceof Error ? error.message : "Não foi possível vincular o canal ao MBLZ." }] };
          }
        }
      }),
      { name: "mblz_pair" }
    );

    api.registerTool(
      (toolContext) => ({
        name: "mblz_context",
        description: "Read the current sender's authorized MBLZ legal context. Use before answering about deadlines, tasks, matters, contracts or recent legal intake. Read-only.",
        parameters: Type.Object({}),
        async execute() {
          const identity = runtimeIdentity(toolContext);
          if (!identity) {
            return { content: [{ type: "text", text: "MBLZ context is unavailable because this turn has no trusted channel/account/sender identity." }] };
          }
          try {
            const data = await postBridge("/api/internal/openclaw/context", identity);
            return { content: [{ type: "text", text: JSON.stringify(data) }] };
          } catch {
            return { content: [{ type: "text", text: "MBLZ denied context access. Conclua o pareamento do canal no MBLZ antes de consultar dados jurídicos." }] };
          }
        }
      }),
      { name: "mblz_context" }
    );
  }
});
