// "Bring your own key" provider: the installation owner supplies an API key for a provider they
// chose and pay for. This file only builds the request and reads the answer; it never stores the key
// (secret-store.ts does) and never logs request or response bodies. The excerpt reaches the provider
// only through AiProvider.complete(), which chat.ts calls after per-request consent.
import { renderPrompt } from "./chat";
import type { AiProvider, AiRequest, ProviderStatus } from "./provider";

export type ByokKind = "anthropic" | "openai-compatible";
export type ByokConfig = { kind: ByokKind; model: string; baseUrl?: string; freeTier?: boolean };

export const ANTHROPIC_URL = "https://api.anthropic.com";
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const MAX_ANSWER_BYTES = 256 * 1024;

export class ByokConfigError extends Error {}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https only; plain http is accepted for a server on this same computer (e.g. a local model). No credentials, query or fragment. */
export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new ByokConfigError("Endereço do provedor inválido."); }
  const local = LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new ByokConfigError("Use um endereço https (http só para servidor neste computador).");
  if (url.username || url.password || url.search || url.hash) throw new ByokConfigError("O endereço não pode ter usuário, senha, parâmetros ou fragmento.");
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export function validateConfig(input: { kind: string; model: string; baseUrl?: string | null; freeTier?: boolean }): ByokConfig {
  if (input.kind !== "anthropic" && input.kind !== "openai-compatible") throw new ByokConfigError("Tipo de provedor desconhecido.");
  const model = input.model.trim();
  if (!MODEL_RE.test(model)) throw new ByokConfigError("Nome do modelo inválido.");
  const freeTier = input.freeTier === true ? { freeTier: true } : {};
  if (input.kind === "anthropic") return { kind: "anthropic", model, ...freeTier };
  if (!input.baseUrl?.trim()) throw new ByokConfigError("Informe o endereço da API compatível com OpenAI.");
  return { kind: "openai-compatible", model, baseUrl: normalizeBaseUrl(input.baseUrl), ...freeTier };
}

export const validateApiKey = (key: string) => {
  const k = key.trim();
  if (k.length < 8 || k.length > 400 || /\s/.test(k)) throw new ByokConfigError("Chave inválida.");
  return k;
};

/** The model may wrap JSON in prose or a code fence; take the outermost object. Anything else is left for chat.ts to reject. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

type Fetch = typeof fetch;

export function createByokProvider(config: ByokConfig, apiKey: string, fetchImpl: Fetch = fetch): AiProvider {
  const external = !(config.baseUrl && LOOPBACK.has(new URL(config.baseUrl).hostname));
  const host = config.kind === "anthropic" ? "api.anthropic.com" : new URL(config.baseUrl!).host;
  const status = (): ProviderStatus => ({
    id: `byok-${config.kind}`,
    label: `${config.kind === "anthropic" ? "Claude (Anthropic)" : "API compatível com OpenAI"} · ${config.model} · ${host}`,
    state: "available",
    reason: config.freeTier
      ? "Plano GRATUITO informado pelo titular. Planos gratuitos costumam permitir que o provedor use e até revise o conteúdo enviado para melhorar seus produtos: não envie dados de clientes ou sigilosos."
      : "Provedor configurado com a chave do titular desta instalação.",
    sendsDataOutsideDevice: external,
    ...(config.freeTier ? { freeTier: true } : {}),
    // No terms are claimed: retention/training/commercial-use have not been verified by a person for this account.
  });

  async function post(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<unknown> {
    const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal, redirect: "error", credentials: "omit", cache: "no-store" });
    if (!res.ok) throw new Error(`provider-http-${res.status}`); // never include the response body: it may echo the request
    const text = await res.text();
    if (text.length > MAX_ANSWER_BYTES) throw new Error("provider-answer-too-large");
    return JSON.parse(text);
  }

  async function complete(request: AiRequest, signal: AbortSignal): Promise<unknown> {
    const prompt = renderPrompt(request.question, request.context);
    if (config.kind === "anthropic") {
      const data = await post(`${ANTHROPIC_URL}/v1/messages`, { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        { model: config.model, max_tokens: 2000, system: request.systemRules, messages: [{ role: "user", content: prompt }] }, signal) as { content?: { type: string; text?: string }[] };
      return extractJson((data.content ?? []).filter(c => c.type === "text").map(c => c.text ?? "").join(""));
    }
    const data = await post(`${config.baseUrl}/chat/completions`, { Authorization: `Bearer ${apiKey}` },
      { model: config.model, temperature: 0, messages: [{ role: "system", content: request.systemRules }, { role: "user", content: prompt }] }, signal) as { choices?: { message?: { content?: string } }[] };
    return extractJson(data.choices?.[0]?.message?.content ?? "");
  }
  return { status, complete };
}
