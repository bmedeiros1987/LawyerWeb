// Paragraph and token structure of a text, always with offsets into the ORIGINAL string (UTF-16 code units),
// so every observation can quote the exact source span.
export type Para = { index: number; start: number; end: number; text: string; page: number | null; label: string | null; bodyStart: number; body: string; key: string };

const PREFIX = String.raw`(?:CL[ÁA]USULA|Cl[áa]usula|ARTIGO|Artigo|ART\.?|Art\.?|§§?)`;
// A clause label: "CLÁUSULA 5", "Art. 3º", "1.1.", "2.", "a)", "I -". A bare number such as "12 meses…" is NOT a label.
const LABELS: RegExp[] = [
  new RegExp(String.raw`^\s*(${PREFIX}\s*(?:\d+(?:\.\d+)*|[IVXLCDM]+|[a-z])\s*[ºª°]?\s*[.):\-–—]?)(?=\s|$)`),
  /^\s*(\d+(?:\.\d+)+\.?)(?=\s)/,
  /^\s*((?:\d+|[IVXLCDM]+|[a-z])\s*[.)]|(?:\d+|[IVXLCDM]+)\s+[-–—])(?=\s)/,
];

export function splitLabel(text: string): { label: string | null; bodyOffset: number } {
  for (const re of LABELS) {
    const m = re.exec(text);
    if (m) return { label: m[1], bodyOffset: m[0].length };
  }
  return { label: null, bodyOffset: 0 };
}

export const normalizeSpace = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
/** Label identity ignoring spacing and trailing punctuation: "Cláusula 5ª." and "CLÁUSULA 5" differ only in case. */
export const labelKey = (l: string | null) => (l === null ? "" : l.normalize("NFC").replace(/[\s.):\-–—ºª°]+/g, " ").trim().toLowerCase());

export function paragraphs(text: string): Para[] {
  const out: Para[] = [];
  const hasPages = text.includes("\f");
  const re = /[^\n\f]+/g;
  let m: RegExpExecArray | null, page = 1, last = 0;
  while ((m = re.exec(text))) {
    if (hasPages) { for (let i = last; i < m.index; i++) if (text.charCodeAt(i) === 12) page++; last = m.index; }
    if (!m[0].trim()) continue;
    const { label, bodyOffset } = splitLabel(m[0]);
    const body = m[0].slice(bodyOffset);
    out.push({ index: out.length, start: m.index, end: m.index + m[0].length, text: m[0], page: hasPages ? page : null, label, bodyStart: m.index + bodyOffset, body, key: normalizeSpace(body) });
  }
  return out;
}

export type Token = { text: string; start: number; end: number };
/** Words, numbers (kept whole: 1.000,00) and punctuation; whitespace is skipped. Offsets are absolute (`base` + local). */
export function tokens(s: string, base: number): Token[] {
  const out: Token[] = [];
  for (const m of s.matchAll(/\p{L}[\p{L}\p{N}'’-]*|\p{N}[\p{N}.,/]*\p{N}|\p{N}|[^\s\p{L}\p{N}]/gu)) out.push({ text: m[0], start: base + m.index!, end: base + m.index! + m[0].length });
  return out;
}
