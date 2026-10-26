// Pure normalization selectively reused from PR47 (6f02263); no network code,
// public API key fallback, cron, web-push or server ingestion copied.
import { dataJudMovementBody, dataJudMovementIdentity, normalizeProcessNumber, type DataJudProcess } from "./court-datajud.ts";
import { djenPublicationBody, djenPublicationIdentity, djenPublicationDate, type DjenPublication } from "./court-djen.ts";
import { ProviderUnavailable, type Page } from "./court-sync.ts";
import { createHash } from "node:crypto";

const MAX_BASELINE_IDENTITIES = 20_000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type DataJudBaseline = {
  version: 2; source: "DATAJUD"; number: string; processIdentity: string; seen: string[];
};
function readBaseline(cursor: string, number: string, processIdentity: string): DataJudBaseline {
  let baseline: DataJudBaseline;
  try { baseline = JSON.parse(cursor); } catch { throw new ProviderUnavailable("INVALID_DATAJUD_BASELINE"); }
  if (!baseline || baseline.version !== 2 || baseline.source !== "DATAJUD" ||
    baseline.number !== number || !Array.isArray(baseline.seen) ||
    baseline.seen.length > MAX_BASELINE_IDENTITIES ||
    baseline.seen.some(value => typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)))
    throw new ProviderUnavailable("INVALID_DATAJUD_BASELINE");
  if (baseline.processIdentity !== processIdentity) throw new ProviderUnavailable("DATAJUD_SOURCE_ID_CHANGED");
  return baseline;
}

/** Full DataJud response required. Never use event dates as an incremental cursor. */
export function dataJudPage(number: string, process: DataJudProcess | null, cursor: string | null): Page {
  const normalized = normalizeProcessNumber(number);
  if (normalized.length !== 20) throw new ProviderUnavailable("INVALID_NUMBER");
  if (!process) throw new ProviderUnavailable("PROCESS_NOT_FOUND");
  if (normalizeProcessNumber(process.numeroProcesso ?? "") !== normalized)
    throw new ProviderUnavailable("PROCESS_MISMATCH");
  const processIdentity = hash(process.id);
  const previous = cursor === null ? null : readBaseline(cursor, normalized, processIdentity);
  const seen = new Set(previous?.seen ?? []);
  // Identity ledger covers the whole initial snapshot, including historical rows
  // deliberately not imported. Do not evict identities: that would reannounce history.
  const identities = new Map<string, typeof process.movimentos[number]>();
  for (const movement of process.movimentos) {
    const identity = hash(dataJudMovementIdentity(process.id, movement).externalId);
    identities.set(identity, movement);
  }
  if (new Set([...seen, ...identities.keys()]).size > MAX_BASELINE_IDENTITIES)
    throw new ProviderUnavailable("DATAJUD_BASELINE_LIMIT");
  const sorted = [...identities].sort(([aId, a], [bId, b]) => {
    const time = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
    return time(a.dataHora) - time(b.dataHora) || aId.localeCompare(bId);
  });
  const candidates = previous === null ? sorted : sorted.filter(([identity]) => !seen.has(identity));
  const selected = previous === null ? candidates.slice(-1) : candidates.slice(0, 200);
  // Initial evidence is optional historical capture, not a newly observed movement.
  // Once established, even undated/delayed identities are candidates; dates are not the cursor.
  for (const [identity] of previous === null ? sorted : selected) seen.add(identity);
  const next: DataJudBaseline = { version: 2, source: "DATAJUD", number: normalized,
    processIdentity, seen: [...seen].sort() };
  const nextCursor = JSON.stringify(next);
  const complete = previous === null || candidates.length <= 200;
  return { events: selected.map(([, movement]) => ({
    id: dataJudMovementIdentity(process.id, movement).externalId,
    title: movement.nome?.trim() || "Movimentação processual",
    body: dataJudMovementBody(movement), occurredAt: movement.dataHora ?? null,
    notify: previous !== null,
    evidence: { provider: "CNJ_DATAJUD_PUBLIC", processId: process.id,
      providerUpdatedAt: process.dataHoraUltimaAtualizacao ?? null, movement,
      syncClassification: previous === null ? "INITIAL_BASELINE" : "NEW_PROVIDER_IDENTITY" },
  })), cursor: nextCursor, complete, ...(complete ? {} : { checkpointCursor: nextCursor }) };
}

/** Provider supplies pagination/window proof. Incomplete batches cannot advance state. */
export function djenPage(number: string, publications: DjenPublication[], cursor: string | null, complete: boolean,
  window: { startDate: string; endDate: string }): Page {
  const normalized = normalizeProcessNumber(number);
  if (normalized.length !== 20) throw new ProviderUnavailable("INVALID_NUMBER");
  if (publications.some(p => normalizeProcessNumber(p.numero_processo ?? p.numeroprocessocommascara ?? "") !== normalized))
    throw new ProviderUnavailable("PROCESS_MISMATCH");
  const sorted = publications.slice().sort((a, b) =>
    (djenPublicationDate(a)?.getTime() ?? 0) - (djenPublicationDate(b)?.getTime() ?? 0));
  const selected = sorted.slice(-200);
  return { events: selected.map((publication, index) => ({
    id: djenPublicationIdentity(publication).externalId,
    title: "DJEN · Publicação oficial", body: djenPublicationBody(publication),
    occurredAt: djenPublicationDate(publication)?.toISOString() ?? null,
    notify: cursor !== null || index === selected.length - 1,
    evidence: { provider: "CNJ_DJEN_PUBLIC", publication, queryWindow: window },
  })), cursor: "window:" + window.endDate, complete: complete && publications.length <= 200 };
}
