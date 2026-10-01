import { createHash } from "node:crypto";
import { normalizeProcessNumber } from "@/lib/courts/datajud";

const DJEN_BASE_URL = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";
const PAGE_SIZE = 5;
const MAX_PAGES_PER_PROCESS = 2;

export type DjenPublication = {
  id?: number | string | null;
  data_disponibilizacao?: string | null;
  datadisponibilizacao?: string | null;
  siglaTribunal?: string | null;
  tipoComunicacao?: string | null;
  nomeOrgao?: string | null;
  texto?: string | null;
  numero_processo?: string | null;
  numeroprocessocommascara?: string | null;
  meio?: string | null;
  meiocompleto?: string | null;
  link?: string | null;
  tipoDocumento?: string | null;
  nomeClasse?: string | null;
  codigoClasse?: string | number | null;
  numeroComunicacao?: string | number | null;
  ativo?: boolean | null;
  hash?: string | null;
  destinatarios?: Array<{ nome?: string | null; polo?: string | null }> | null;
  destinatarioadvogados?: Array<{
    advogado?: {
      nome?: string | null;
      numero_oab?: string | null;
      uf_oab?: string | null;
    } | null;
  }> | null;
};

type DjenResponse = {
  status?: string | null;
  message?: string | null;
  count?: number | null;
  items?: DjenPublication[] | null;
};

export class DjenRateLimitError extends Error {
  readonly retryAfterSeconds: number | null;
  constructor(retryAfterSeconds: number | null) {
    super("DJEN limitou temporariamente as consultas.");
    this.name = "DjenRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function brasiliaDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function cleanText(value?: string | null) {
  if (!value) return "";
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, """)
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function httpsUrl(value?: string | null) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function certificateUrl(hash?: string | null) {
  const clean = hash?.trim();
  if (!clean || !/^[A-Za-z0-9_-]{8,256}$/.test(clean)) return null;
  return `${DJEN_BASE_URL}/${encodeURIComponent(clean)}/certidao`;
}

export function djenPublicationDate(publication: DjenPublication) {
  const value = publication.data_disponibilizacao ?? publication.datadisponibilizacao ?? null;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function djenPublicationBody(publication: DjenPublication) {
  const text = cleanText(publication.texto);
  const metadata = [
    publication.tipoComunicacao ? `Tipo: ${publication.tipoComunicacao}` : null,
    publication.nomeOrgao ? `Órgão: ${publication.nomeOrgao}` : null,
    publication.data_disponibilizacao ? `Disponibilização no DJEN: ${publication.data_disponibilizacao}` : null,
    "Fonte: Conselho Nacional de Justiça (CNJ) / Diário de Justiça Eletrônico Nacional (DJEN).",
    "Esta publicação exige revisão humana e não constitui prazo confirmado no MBLZ.",
  ].filter(Boolean);
  return [text, ...metadata].filter(Boolean).join("\n\n");
}

export function djenPublicationIdentity(publication: DjenPublication) {
  const canonical = JSON.stringify({
    id: publication.id ?? null,
    hash: publication.hash ?? null,
    numeroComunicacao: publication.numeroComunicacao ?? null,
    numeroProcesso: normalizeProcessNumber(publication.numero_processo ?? ""),
    data: publication.data_disponibilizacao ?? publication.datadisponibilizacao ?? null,
    tribunal: publication.siglaTribunal ?? null,
    tipo: publication.tipoComunicacao ?? null,
    orgao: publication.nomeOrgao ?? null,
    texto: cleanText(publication.texto),
    ativo: publication.ativo ?? null,
  });
  const contentHash = createHash("sha256").update(canonical).digest("hex");
  const stable = publication.hash?.trim()
    || (publication.numeroComunicacao != null ? String(publication.numeroComunicacao) : null)
    || (publication.id != null ? String(publication.id) : null)
    || contentHash.slice(0, 32);
  return {
    externalId: `djen:${stable}`,
    contentHash,
  };
}

export function djenOfficialUrl(publication: DjenPublication) {
  return certificateUrl(publication.hash) ?? httpsUrl(publication.link);
}

export async function fetchDjenPublications(processNumber: string) {
  const normalized = normalizeProcessNumber(processNumber);
  if (normalized.length !== 20) throw new Error("Número CNJ inválido para consulta DJEN.");

  const startDate = brasiliaDate(-1);
  const endDate = brasiliaDate(0);
  const publications: DjenPublication[] = [];
  let total = 0;
  let truncated = false;

  for (let page = 1; page <= MAX_PAGES_PER_PROCESS; page += 1) {
    const query = new URLSearchParams({
      numeroProcesso: normalized,
      dataDisponibilizacaoInicio: startDate,
      dataDisponibilizacaoFim: endDate,
      pagina: String(page),
      itensPorPagina: String(PAGE_SIZE),
    });
    const response = await fetch(`${DJEN_BASE_URL}?${query.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    if (response.status === 429) {
      const raw = response.headers.get("retry-after");
      const retryAfter = raw && /^\d+$/.test(raw) ? Number(raw) : null;
      throw new DjenRateLimitError(retryAfter);
    }
    if (!response.ok) throw new Error(`DJEN indisponível (${response.status}).`);

    const payload = await response.json() as DjenResponse;
    const items = Array.isArray(payload.items) ? payload.items : [];
    total = typeof payload.count === "number" ? payload.count : items.length;

    for (const item of items) {
      if (normalizeProcessNumber(item.numero_processo ?? "") !== normalized) continue;
      publications.push(item);
    }

    if (items.length < PAGE_SIZE || publications.length >= total) break;
    if (page === MAX_PAGES_PER_PROCESS && total > publications.length) truncated = true;
  }

  return {
    publications,
    total,
    truncated,
    window: { startDate, endDate },
  };
}
