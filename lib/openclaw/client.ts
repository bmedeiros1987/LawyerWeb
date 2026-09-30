import crypto from "node:crypto";

type OpenClawResponse = {
  id?: string;
  status?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string; type?: string };
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function openClawConfigured() {
  return Boolean(process.env.OPENCLAW_GATEWAY_URL?.trim() && process.env.OPENCLAW_GATEWAY_TOKEN?.trim());
}

export function openClawSessionKey(workspaceId: string, userId: string, channel: string) {
  const salt = required("OPENCLAW_SESSION_SALT");
  const digest = crypto.createHmac("sha256", salt).update(`${workspaceId}:${userId}:${channel}`).digest("hex");
  return `mblz:${digest.slice(0, 40)}`;
}

function extractText(payload: OpenClawResponse) {
  const chunks: string[] = [];
  for (const item of payload.output ?? []) {
    for (const part of item.content ?? []) {
      if ((part.type === "output_text" || part.type === "text") && part.text) chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

export async function askOpenClaw(input: {
  workspaceId: string;
  userId: string;
  channel?: "WEB" | "EMAIL" | "WHATSAPP" | "TELEGRAM";
  message: string;
  instructions: string;
}) {
  const base = required("OPENCLAW_GATEWAY_URL").replace(/\/$/, "");
  const token = required("OPENCLAW_GATEWAY_TOKEN");
  const agentId = process.env.OPENCLAW_AGENT_ID?.trim() || "mblz";
  const sessionKey = openClawSessionKey(input.workspaceId, input.userId, input.channel ?? "WEB");

  const response = await fetch(`${base}/v1/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-openclaw-agent-id": agentId,
      "x-openclaw-session-key": sessionKey,
    },
    body: JSON.stringify({
      model: "openclaw",
      user: sessionKey,
      instructions: input.instructions,
      input: input.message,
      max_output_tokens: 1800,
      store: false,
    }),
    signal: AbortSignal.timeout(75_000),
    cache: "no-store",
  });

  const raw = await response.text();
  let payload: OpenClawResponse = {};
  try { payload = raw ? JSON.parse(raw) as OpenClawResponse : {}; } catch {}

  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenClaw returned HTTP ${response.status}`);
  }
  const text = extractText(payload);
  if (!text) throw new Error("OpenClaw returned no visible reply");

  return { responseId: payload.id ?? null, status: payload.status ?? "completed", text, sessionKey };
}
