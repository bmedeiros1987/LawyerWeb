import crypto from "node:crypto";
import { decryptSecret } from "@/lib/crypto";

type WhatsAppConnection = {
  secretEnc: string | null;
  webhookSecretEnc: string | null;
  config?: unknown;
};

type WhatsAppConfig = {
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  graphVersion: string;
};

type WhatsAppSecrets = {
  appSecret: string;
  verifyToken: string;
};

export type WhatsAppInboundMessage = {
  eventId: string;
  waId: string;
  text: string | null;
  type: string;
  displayName: string | null;
  phoneNumberId: string | null;
};

function validateGraphVersion(value: string) {
  const version = value.trim();
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("Versão da Graph API inválida.");
  return version;
}

function accessToken(connection: WhatsAppConnection) {
  if (!connection.secretEnc) throw new Error("Token do WhatsApp Cloud ausente.");
  return decryptSecret(connection.secretEnc);
}

export function whatsappSecrets(connection: WhatsAppConnection): WhatsAppSecrets {
  if (!connection.webhookSecretEnc) throw new Error("Segredos do webhook WhatsApp ausentes.");
  const decoded = JSON.parse(decryptSecret(connection.webhookSecretEnc)) as Partial<WhatsAppSecrets>;
  const appSecret = String(decoded.appSecret ?? "").trim();
  const verifyToken = String(decoded.verifyToken ?? "").trim();
  if (!appSecret || !verifyToken) throw new Error("Segredos do webhook WhatsApp inválidos.");
  return { appSecret, verifyToken };
}

export function whatsappConfig(connection: WhatsAppConnection): WhatsAppConfig {
  const raw = connection.config;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Configuração WhatsApp inválida.");
  const cfg = raw as Record<string, unknown>;
  const phoneNumberId = String(cfg.phoneNumberId ?? "").trim();
  const displayPhoneNumber = String(cfg.displayPhoneNumber ?? "").trim();
  const verifiedName = String(cfg.verifiedName ?? "").trim();
  const graphVersion = validateGraphVersion(String(cfg.graphVersion ?? ""));
  if (!phoneNumberId || !displayPhoneNumber) throw new Error("Configuração WhatsApp incompleta.");
  return { phoneNumberId, displayPhoneNumber, verifiedName, graphVersion };
}

async function graphFetch(version: string, path: string, token: string, init?: RequestInit) {
  const response = await fetch(`https://graph.facebook.com/${validateGraphVersion(version)}/${path.replace(/^\/+/, "")}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  return response;
}

export async function inspectWhatsAppPhone(args: {
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
}) {
  const id = args.phoneNumberId.trim();
  if (!/^\d{5,30}$/.test(id)) throw new Error("Phone Number ID inválido.");
  const response = await graphFetch(args.graphVersion, `${id}?fields=display_phone_number,verified_name`, args.accessToken, { method: "GET" });
  const payload = await response.json().catch(() => null) as { display_phone_number?: string; verified_name?: string; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? `Meta Graph respondeu HTTP ${response.status}.`);
  const displayPhoneNumber = String(payload?.display_phone_number ?? "").trim();
  if (!displayPhoneNumber) throw new Error("A Meta não retornou o número do WhatsApp Business.");
  return {
    phoneNumberId: id,
    displayPhoneNumber,
    verifiedName: String(payload?.verified_name ?? "").trim(),
    graphVersion: validateGraphVersion(args.graphVersion),
  };
}

export function newWhatsAppWebhookSecrets() {
  return { verifyToken: crypto.randomBytes(24).toString("base64url") };
}

export function newWhatsAppPairingCode() {
  return crypto.randomBytes(12).toString("base64url");
}

export function buildWhatsAppPairingLink(displayPhoneNumber: string, code: string) {
  const digits = displayPhoneNumber.replace(/\D/g, "");
  if (!digits) throw new Error("Número WhatsApp inválido para pareamento.");
  return `https://wa.me/${digits}?text=${encodeURIComponent(`MBLZ ${code}`)}`;
}

export function verifyWhatsAppSignature(rawBody: string, signature: string | null, appSecret: string) {
  if (!signature || !signature.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function extractWhatsAppMessages(payload: unknown): WhatsAppInboundMessage[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const entries = Array.isArray((payload as Record<string, unknown>).entry) ? (payload as { entry: unknown[] }).entry : [];
  const out: WhatsAppInboundMessage[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const changes = Array.isArray((entry as Record<string, unknown>).changes) ? (entry as { changes: unknown[] }).changes : [];
    for (const change of changes) {
      if (!change || typeof change !== "object" || Array.isArray(change)) continue;
      const value = (change as Record<string, unknown>).value;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      const metadata = record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? record.metadata as Record<string, unknown>
        : {};
      const phoneNumberId = metadata.phone_number_id == null ? null : String(metadata.phone_number_id);

      const contacts = Array.isArray(record.contacts) ? record.contacts : [];
      const names = new Map<string, string>();
      for (const contact of contacts) {
        if (!contact || typeof contact !== "object" || Array.isArray(contact)) continue;
        const c = contact as Record<string, unknown>;
        const waId = c.wa_id == null ? "" : String(c.wa_id);
        const profile = c.profile && typeof c.profile === "object" && !Array.isArray(c.profile)
          ? c.profile as Record<string, unknown>
          : {};
        const name = String(profile.name ?? "").trim();
        if (waId && name) names.set(waId, name);
      }

      const messages = Array.isArray(record.messages) ? record.messages : [];
      for (const message of messages) {
        if (!message || typeof message !== "object" || Array.isArray(message)) continue;
        const m = message as Record<string, unknown>;
        const eventId = String(m.id ?? "").trim();
        const waId = String(m.from ?? "").trim();
        if (!eventId || !waId) continue;
        const type = String(m.type ?? "").trim() || "unknown";
        const textRecord = m.text && typeof m.text === "object" && !Array.isArray(m.text)
          ? m.text as Record<string, unknown>
          : {};
        const text = type === "text" ? String(textRecord.body ?? "").trim() || null : null;
        out.push({
          eventId,
          waId,
          text,
          type,
          displayName: names.get(waId) ?? null,
          phoneNumberId,
        });
      }
    }
  }
  return out;
}

export async function sendWhatsAppMessage(connection: WhatsAppConnection, to: string, text: string) {
  const cfg = whatsappConfig(connection);
  const token = accessToken(connection);
  const trimmed = text.trim();
  if (!trimmed) return;

  const parts: string[] = [];
  let remaining = trimmed;
  while (remaining.length > 3500) {
    parts.push(remaining.slice(0, 3500));
    remaining = remaining.slice(3500);
  }
  if (remaining) parts.push(remaining);

  for (const part of parts) {
    const response = await graphFetch(cfg.graphVersion, `${cfg.phoneNumberId}/messages`, token, {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: part },
      }),
    });
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    if (!response.ok) throw new Error(payload?.error?.message ?? `Meta Graph respondeu HTTP ${response.status}.`);
  }
}
