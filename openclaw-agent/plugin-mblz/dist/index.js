import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "mblz",
  name: "MBLZ Legal OS",
  description: "Identity-bound read-only context from MBLZ.",
  register(api) {
    api.registerTool({
      name: "mblz_context",
      description: "Read the current authorized user's MBLZ legal context. Use this before answering about deadlines, tasks, matters or contracts. This tool is read-only.",
      parameters: Type.Object({}),
      async execute(_id, _params, ctx) {
        const apiUrl = String(process.env.MBLZ_INTERNAL_API_URL ?? "").replace(/\/$/, "");
        const serviceToken = String(process.env.MBLZ_AGENT_SERVICE_TOKEN ?? "");
        const anyCtx = ctx ?? {};
        const delivery = anyCtx.deliveryContext ?? {};
        const channel = String(anyCtx.nativeChannelId ?? delivery.channel ?? "").toUpperCase();
        const accountId = String(delivery.accountId ?? delivery.account ?? anyCtx.accountId ?? "");

        if (!["WHATSAPP","TELEGRAM"].includes(channel) || !accountId) {
          return { content: [{ type: "text", text: "MBLZ context is unavailable for this session because the channel identity is not bound." }] };
        }
        if (!apiUrl || !serviceToken) {
          return { content: [{ type: "text", text: "MBLZ context bridge is not configured." }] };
        }

        const response = await fetch(apiUrl + "/api/internal/openclaw/context", {
          method: "POST",
          headers: {
            authorization: "Bearer " + serviceToken,
            "content-type": "application/json"
          },
          body: JSON.stringify({ channel, accountId }),
          signal: AbortSignal.timeout(15000)
        });
        const text = await response.text();
        if (!response.ok) {
          return { content: [{ type: "text", text: "MBLZ denied context access for this channel." }] };
        }
        return { content: [{ type: "text", text }] };
      }
    });
  }
});
