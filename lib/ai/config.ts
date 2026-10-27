// Which AI provider this installation uses. Stored per computer in desktop.local_setting; the key is
// sealed with the installation secret and bound (as AAD) to the provider settings, so changing the
// endpoint or model in the database makes the key unreadable instead of sending it elsewhere.
// Without a stored configuration (or an adapter registered by a maintainer) the assistant is unavailable.
import { withClient } from "@/lib/desktop/db";
import { createByokProvider, validateApiKey, validateConfig, type ByokConfig } from "./byok";
import { resolveProvider, unavailableProvider, type AiProvider, type ProviderStatus } from "./provider";
import { openKey, sealKey } from "./secret-store";

const KEY = "ai_provider";
type Stored = { config: ByokConfig; sealed: string; savedAt: string };

const secret = () => process.env.AUTH_SECRET ?? "";
const aad = (c: ByokConfig) => JSON.stringify([c.kind, c.model, c.baseUrl ?? ""]);

async function read(): Promise<Stored | null> {
  const row = await withClient(async c => (await c.query<{ value: string }>("select value from desktop.local_setting where key = $1", [KEY])).rows[0]);
  if (!row) return null;
  try { const s = JSON.parse(row.value) as Stored; return s?.config && typeof s.sealed === "string" ? s : null; } catch { return null; }
}

export async function saveAiProvider(input: { kind: string; model: string; baseUrl?: string | null; apiKey: string }) {
  const config = validateConfig(input);
  const apiKey = validateApiKey(input.apiKey);
  const value: Stored = { config, sealed: sealKey(apiKey, secret(), aad(config)), savedAt: new Date().toISOString() };
  await withClient(c => c.query(
    `insert into desktop.local_setting (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value, updated_at = now()`, [KEY, JSON.stringify(value)]));
  return summary(value, apiKey);
}

export async function clearAiProvider() {
  await withClient(c => c.query("delete from desktop.local_setting where key = $1", [KEY]));
}

const last4 = (k: string) => k.slice(-4);
function summary(s: Stored, plain: string | null) {
  return { configured: true as const, kind: s.config.kind, model: s.config.model, baseUrl: s.config.baseUrl ?? null, keyHint: plain ? `…${last4(plain)}` : null, readable: plain !== null, savedAt: s.savedAt };
}

/** What the settings screen may show: never the key, only its last 4 characters. */
export async function aiProviderSummary() {
  const s = await read();
  if (!s) return { configured: false as const };
  return summary(s, openKey(s.sealed, secret(), aad(s.config)));
}

/** The provider to use now: the stored key, else a maintainer-registered adapter, else the honest "unavailable". */
export async function currentProvider(fetchImpl?: typeof fetch): Promise<AiProvider> {
  const s = await read();
  if (s) {
    const key = openKey(s.sealed, secret(), aad(s.config));
    if (!key) return { status: (): ProviderStatus => ({ ...unavailableProvider.status(), id: "byok-unreadable", label: "Chave de IA ilegível", reason: "A chave guardada não pôde ser lida (instalação restaurada ou configuração alterada). Informe a chave de novo em Configurações." }), complete: unavailableProvider.complete };
    return createByokProvider(s.config, key, fetchImpl);
  }
  return resolveProvider(process.env.MBLZ_AI_PROVIDER);
}
