import { createHash } from "node:crypto";
import { normalizeProcessNumber } from "./court-datajud.ts";

const DJEN_BASE_URL = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";

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
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
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
  // Provider-supplied HTTPS links are not proof of an official origin.
  return certificateUrl(publication.hash);
}
