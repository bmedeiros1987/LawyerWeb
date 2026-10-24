// Deterministic extraction of values, deadlines and dates, each with its exact span. It reports what the text
// SAYS and where it is ambiguous; it never decides what a clause means legally.
export type FactType = "amount" | "percent" | "deadline" | "date";
export type Fact = { type: FactType; raw: string; start: number; end: number; norm: string; ambiguity: string[] };

const MONTHS: Record<string, number> = { janeiro: 1, fevereiro: 2, "março": 3, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const UNITS: Record<string, string> = { dia: "dia", dias: "dia", "mês": "mês", mes: "mês", meses: "mês", ano: "ano", anos: "ano", hora: "hora", horas: "hora", semana: "semana", semanas: "semana" };

const ONES: Record<string, number> = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, "três": 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19 };
const TENS: Record<string, number> = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };
const HUNDREDS: Record<string, number> = { cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900 };

/** Portuguese cardinal words (0–999) → number, or null if any word is not understood. */
export function extensoToNumber(words: string): number | null {
  const parts = words.toLowerCase().normalize("NFC").split(/[\s-]+/).filter(w => w && w !== "e");
  if (!parts.length) return null;
  let total = 0;
  for (const w of parts) {
    const v = ONES[w] ?? TENS[w] ?? HUNDREDS[w];
    if (v === undefined) return null;
    total += v;
  }
  return total;
}

function cents(raw: string): { norm: string; ambiguity: string[] } {
  const n = raw.replace(/^R\$\s*/, "").replace(/\s*reais$/i, "").trim();
  if (/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(n) || /^\d+(,\d{1,2})?$/.test(n)) {
    const [int, dec = ""] = n.replace(/\./g, "").split(",");
    return { norm: `${BigInt(int) * 100n + BigInt(dec.padEnd(2, "0"))}`, ambiguity: [] };
  }
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(n)) return { norm: n, ambiguity: ["Formato numérico americano (vírgula como milhar e ponto como decimal): conferir o valor."] };
  if (/^\d+\.\d{1,2}$/.test(n)) return { norm: n, ambiguity: ["Ponto antes de 1 ou 2 dígitos: pode ser decimal ou milhar. Conferir o valor."] };
  return { norm: n, ambiguity: ["Formato de valor não reconhecido: conferir."] };
}

const validDate = (d: number, m: number, y: number) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function extractFacts(text: string, base = 0): Fact[] {
  const found: Fact[] = [];
  const add = (type: FactType, m: RegExpMatchArray, norm: string, ambiguity: string[] = [], raw = m[0]) =>
    found.push({ type, raw, start: base + m.index!, end: base + m.index! + raw.length, norm, ambiguity });

  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)) {
    const d = +m[1], mo = +m[2], yRaw = m[3], y = yRaw.length === 2 ? 2000 + +yRaw : +yRaw, amb: string[] = [];
    if (!validDate(d, mo, y)) amb.push("Data inexistente no calendário: conferir.");
    else {
      if (yRaw.length === 2) amb.push("Ano com 2 dígitos: século não explícito.");
      if (d <= 12 && mo <= 12 && d !== mo) amb.push("Dia e mês ambos até 12: pode ser dia/mês ou mês/dia. Conferir o formato.");
    }
    add("date", m, amb.some(a => a.startsWith("Data inexistente")) ? m[0] : `${y}-${pad(mo)}-${pad(d)}`, amb);
  }
  for (const m of text.matchAll(/\b(\d{1,2})(?:º|°)?\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})\b/gi)) {
    const d = +m[1], mo = MONTHS[m[2].toLowerCase()], y = +m[3];
    add("date", m, validDate(d, mo, y) ? `${y}-${pad(mo)}-${pad(d)}` : m[0], validDate(d, mo, y) ? [] : ["Data inexistente no calendário: conferir."]);
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const ok = validDate(+m[3], +m[2], +m[1]);
    add("date", m, ok ? m[0] : m[0], ok ? [] : ["Data inexistente no calendário: conferir."]);
  }
  const unit = "(dias?|meses|m[eê]s|anos?|horas?|semanas?)", qual = "(?:\\s+(úteis|uteis|corridos|consecutivos|seguidos))?";
  const deadline = (m: RegExpMatchArray, numStr: string, extenso: string | null, u: string, q: string | undefined) => {
    const n = +numStr, key = UNITS[u.toLowerCase().normalize("NFC")] ?? u.toLowerCase(), amb: string[] = [];
    if (extenso !== null) { const e = extensoToNumber(extenso); if (e !== null && e !== n) amb.push(`Número (${n}) e extenso ("${extenso.trim()}" = ${e}) divergem: conferir qual vale.`); if (e === null) amb.push(`Extenso "${extenso.trim()}" não reconhecido: conferir.`); }
    if (key === "dia" && !q) amb.push("Prazo em dias sem indicar se são úteis ou corridos: conferir.");
    add("deadline", m, `${n} ${key}${q ? " " + q.toLowerCase().replace("uteis", "úteis") : ""}`, amb);
  };
  for (const m of text.matchAll(new RegExp(String.raw`(\d{1,4})\s*(?:\(([^)]{1,60})\)\s*)?${unit}${qual}\b`, "gi"))) deadline(m, m[1], m[2] ?? null, m[3], m[4]);
  for (const m of text.matchAll(new RegExp(String.raw`([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ \-]{1,40}?)\s*\((\d{1,4})\)\s*${unit}${qual}\b`, "gi"))) {
    if (extensoToNumber(m[1]) !== null) deadline(m, m[2], m[1], m[3], m[4]);
  }
  for (const m of text.matchAll(/R\$\s*\d[\d.,]*\d|R\$\s*\d|\b\d{1,3}(?:\.\d{3})*,\d{2}\s+reais\b/g)) { const c = cents(m[0]); add("amount", m, c.norm, c.ambiguity); }
  for (const m of text.matchAll(/\b\d+(?:,\d+)?\s*(?:%|por cento)/gi)) add("percent", m, m[0].replace(/\s*(%|por cento)/i, "%").replace(",", "."));

  // Overlaps (e.g. a number inside a date) keep the earliest/longest; stable order by position.
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Fact[] = [];
  for (const f of found) { const last = out[out.length - 1]; if (last && f.start < last.end) continue; out.push(f); }
  return out;
}
