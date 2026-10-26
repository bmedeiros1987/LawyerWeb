// Prepared read-only transport. The application route does NOT import this file.
// Activation requires a separate reviewed change; no env flags or fallback keys.
import { dataJudAliasForMatter, normalizeProcessNumber, type DataJudProcess } from "./court-datajud.ts";
import { dataJudPage } from "./court-adapters.ts";
import { ProviderUnavailable, type Provider, type Source } from "./court-sync.ts";

type Options = {
  source: Source; number: string; court?: string | null; secrecy: boolean; active: boolean;
  enabled?: boolean; dataJudPublicKey?: string;
  fetchImpl: typeof fetch;
};
const MAX_BYTES = 2 * 1024 * 1024;
async function jsonResponse(fetchImpl: typeof fetch, url: string, init: RequestInit) {
  let response: Response;
  try { response = await fetchImpl(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) }); }
  catch (error) {
    throw new ProviderUnavailable(error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "TIMEOUT" : "PROVIDER_UNAVAILABLE");
  }
  if (response.status === 429) throw new ProviderUnavailable("RATE_LIMIT");
  if (!response.ok) throw new ProviderUnavailable("PROVIDER_UNAVAILABLE");
  const declaredSize = Number(response.headers.get("content-length"));
  if (declaredSize > MAX_BYTES) throw new ProviderUnavailable("INVALID_RESPONSE");
  // Bound streamed data, not just declared Content-Length.
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderUnavailable("INVALID_RESPONSE");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.length;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new ProviderUnavailable("INVALID_RESPONSE"); }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof ProviderUnavailable) throw error;
    throw new ProviderUnavailable("PROVIDER_UNAVAILABLE");
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>; }
  catch { throw new ProviderUnavailable("INVALID_RESPONSE"); }
}
export function createCourtReadProvider(options: Options): Provider {
  return { source: options.source, async read(cursor) {
    if (options.enabled !== true) throw new ProviderUnavailable("DESKTOP_NETWORK_DISABLED");
    if (options.secrecy || !options.active) throw new ProviderUnavailable("INELIGIBLE_PROCESS");
    // Do not expose an enableable paginator until the official backlog/window contract is validated.
    if (options.source === "DJEN") throw new ProviderUnavailable("DJEN_PAGINATION_NOT_VALIDATED");
    const number = normalizeProcessNumber(options.number);
    if (number.length !== 20) throw new ProviderUnavailable("INVALID_NUMBER");
    if (options.source === "DATAJUD") {
      const key = options.dataJudPublicKey?.trim();
      if (!key) throw new ProviderUnavailable("MISSING_CREDENTIALS");
      const alias = dataJudAliasForMatter(number, options.court);
      if (!alias) throw new ProviderUnavailable("UNSUPPORTED_COURT");
      const payload = await jsonResponse(options.fetchImpl,
        "https://api-publica.datajud.cnj.jus.br/api_publica_" + alias + "/_search", {
          method: "POST", headers: { Authorization: "APIKey " + key, "Content-Type": "application/json" },
          body: JSON.stringify({ size: 2, query: { term: { numeroProcesso: number } },
            _source: ["id", "tribunal", "numeroProcesso", "dataHoraUltimaAtualizacao", "movimentos"] }),
        });
      const hits = (payload.hits as { hits?: Array<{ _id?: string; _source?: Partial<DataJudProcess> }> } | undefined)?.hits;
      if (!Array.isArray(hits)) throw new ProviderUnavailable("INVALID_RESPONSE");
      const exact = hits.filter(hit => normalizeProcessNumber(hit._source?.numeroProcesso ?? "") === number);
      if (exact.length !== 1) throw new ProviderUnavailable(exact.length ? "AMBIGUOUS_PROCESS" : "PROCESS_NOT_FOUND");
      const source = exact[0]._source!;
      if (!Array.isArray(source.movimentos) || source.movimentos.some(m => !m || typeof m !== "object"))
        throw new ProviderUnavailable("INVALID_RESPONSE");
      return dataJudPage(number, { ...source, id: source.id || exact[0]._id || alias + ":" + number,
        movimentos: source.movimentos } as DataJudProcess, cursor);
    }
    throw new ProviderUnavailable("UNSUPPORTED_SOURCE");
  } };
}
