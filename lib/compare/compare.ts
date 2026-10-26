// Deterministic, local comparison of two texts (contracts, addenda, versions). No network, no AI, no clock, no
// randomness: the same two inputs always give byte-identical output. Every observation points at exact source
// spans (`quote` is always `text.slice(start, end)` of that side) and says what a person should check. It reports
// textual differences only; it never interprets their legal effect and never changes any document.
import crypto from "node:crypto";
import { TooDifferent, diffSequences } from "./myers";
import { extractFacts, type Fact, type FactType } from "./facts";
import { labelKey, paragraphs, tokens, type Para } from "./text";

export const COMPARE_LIMITS = { maxChars: 400_000, maxParagraphs: 6000, maxParagraphEdits: 2000, maxWordEdits: 800, maxObservations: 400, minSimilarity: 0.5, maxPairingCells: 250_000, maxQuote: 1200, maxChangesPerParagraph: 8 };
export type CompareLimits = typeof COMPARE_LIMITS;

export type Side = "left" | "right";
export type Source = { side: Side; paragraph: number; page: number | null; start: number; end: number; quote: string; clipped?: boolean };
export type ObservationKind = "inserted" | "deleted" | "changed" | "renumbered" | "moved" | "value-changed" | "value-added" | "value-removed" | "ambiguous" | "cross-reference";
export type Observation = { id: string; kind: ObservationKind; severity: "info" | "attention"; title: string; sources: Source[]; check: string; detail?: string };
export type Change = { left: { start: number; end: number } | null; right: { start: number; end: number } | null };
export type Row = { kind: "equal" | "changed" | "deleted" | "inserted" | "renumbered" | "moved"; left?: number; right?: number; changes?: Change[]; moveId?: number };
export type ParaView = { index: number; start: number; end: number; text: string; page: number | null };

export type CompareResult =
  | { status: "ok"; left: { sha256: string; length: number; paragraphs: ParaView[] }; right: { sha256: string; length: number; paragraphs: ParaView[] }; rows: Row[]; observations: Observation[];
      stats: Record<"equal" | "changed" | "deleted" | "inserted" | "renumbered" | "moved", number>; truncated: boolean; notes: string[] }
  | { status: "too-large" | "too-different"; message: string };

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const view = (p: Para): ParaView => ({ index: p.index, start: p.start, end: p.end, text: p.text, page: p.page });
const wordSet = (key: string) => new Set(key.toLowerCase().match(/\p{L}+|\p{N}+/gu) ?? []);
const jaccard = (a: Set<string>, b: Set<string>) => { if (!a.size && !b.size) return 1; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };
const TYPE_NAME: Record<FactType, string> = { amount: "Valor", percent: "Percentual", deadline: "Prazo", date: "Data" };

const CHECK = {
  inserted: "Conferir o conteúdo incluído e como ele se relaciona com as cláusulas já existentes.",
  deleted: "Conferir se a exclusão é intencional e se outras cláusulas dependiam deste trecho.",
  changed: "Conferir as palavras alteradas nos dois textos e se o sentido pretendido foi mantido.",
  renumbered: "Conferir as referências cruzadas a esta cláusula no restante do documento.",
  moved: "Conferir se a mudança de posição altera a ordem de leitura, a numeração ou as referências.",
  value: "Conferir se a mudança de valor é intencional e coerente com os demais trechos que o citam.",
  deadline: "Conferir o termo inicial, a unidade (dias úteis ou corridos) e a coerência com cláusulas relacionadas.",
  date: "Conferir a data (e o formato dia/mês) diretamente nos documentos originais.",
  percent: "Conferir a base de cálculo e se a mudança é intencional.",
  added: "Conferir este item incluído e a que obrigação ou cláusula ele se refere.",
  removed: "Conferir se a retirada deste item é intencional e se algo dependia dele.",
  crossref: "Conferir se esta referência continua apontando para a cláusula pretendida após a renumeração.",
} as const;

class Builder {
  list: Observation[] = []; truncated = false;
  constructor(private limits: CompareLimits, private L: Para[], private R: Para[]) {}
  para(side: Side, i: number) { return (side === "left" ? this.L : this.R)[i]; }
  src(side: Side, paragraph: number, start: number, end: number): Source {
    const p = this.para(side, paragraph); const clipped = end - start > this.limits.maxQuote;
    const e = clipped ? start + this.limits.maxQuote : end;
    // The quote is always a literal slice of the original text of that side (see compare.test invariants).
    return { side, paragraph, page: p.page, start, end: e, quote: (side === "left" ? this.textL : this.textR).slice(start, e), ...(clipped ? { clipped: true } : {}) };
  }
  textL = ""; textR = "";
  add(o: Omit<Observation, "id">) {
    if (this.list.length >= this.limits.maxObservations) { this.truncated = true; return; }
    this.list.push({ id: `o${this.list.length + 1}`, ...o });
  }
}

function factPairs(left: Fact[], right: Fact[]) {
  // Same value AND same ambiguity: a value that became (or stopped being) ambiguous is a difference worth showing.
  const count = new Map<string, number>(), key = (f: Fact) => `${f.type}|${f.norm}|${f.ambiguity.join("/")}`;
  for (const f of right) count.set(key(f), (count.get(key(f)) ?? 0) + 1);
  const leftRest: Fact[] = [];
  for (const f of left) { const c = count.get(key(f)) ?? 0; if (c > 0) count.set(key(f), c - 1); else leftRest.push(f); }
  const rightRest: Fact[] = [], seen = new Map<string, number>();
  const taken = new Map<string, number>(); for (const f of left) taken.set(key(f), (taken.get(key(f)) ?? 0) + 1);
  for (const f of right) { const k = key(f), used = seen.get(k) ?? 0; seen.set(k, used + 1); if (used >= (taken.get(k) ?? 0)) rightRest.push(f); }
  return { leftRest, rightRest };
}

function dayDiff(a: string, b: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function compareTexts(leftText: string, rightText: string, limits: CompareLimits = COMPARE_LIMITS): CompareResult {
  if (leftText.length > limits.maxChars || rightText.length > limits.maxChars)
    return { status: "too-large", message: `Texto grande demais para comparar de uma vez (limite de ${limits.maxChars.toLocaleString("pt-BR")} caracteres por documento). Compare por partes.` };
  const L = paragraphs(leftText), R = paragraphs(rightText);
  if (L.length > limits.maxParagraphs || R.length > limits.maxParagraphs)
    return { status: "too-large", message: `Parágrafos demais para comparar de uma vez (limite de ${limits.maxParagraphs}). Compare por partes.` };

  const ids = new Map<string, number>(), id = (k: string) => ids.get(k) ?? (ids.set(k, ids.size), ids.size - 1);
  const A = L.map(p => id(p.key)), B = R.map(p => id(p.key));
  let ops;
  try { ops = diffSequences(A, B, limits.maxParagraphEdits); }
  catch (e) { if (e instanceof TooDifferent) return { status: "too-different", message: "Os textos diferem demais para um alinhamento confiável. Compare versões mais próximas ou por partes." }; throw e; }

  const b = new Builder(limits, L, R); b.textL = leftText; b.textR = rightText;
  const rows: Row[] = [];
  const sims = new Map<number, Set<string>>(), sset = (side: Side, p: Para) => { const k = (side === "left" ? 0 : 1e7) + p.index; let s = sims.get(k); if (!s) { s = wordSet(p.key); sims.set(k, s); } return s; };

  const wordChanges = (l: Para, r: Para): Change[] => {
    const tl = tokens(l.body, l.bodyStart), tr = tokens(r.body, r.bodyStart);
    let o;
    try { o = diffSequences(tl.map(t => t.text), tr.map(t => t.text), limits.maxWordEdits); }
    catch { return [{ left: { start: l.bodyStart, end: l.end }, right: { start: r.bodyStart, end: r.end } }]; }
    const out: Change[] = []; let cur: { dl: number[]; ir: number[]; at: [number, number] } | null = null;
    // A pure insertion/deletion has no span on the other side: anchor it right after the previous token there.
    const anchor = (toks: typeof tl, i: number, fallback: number) => (i > 0 ? toks[i - 1].end : fallback);
    const flush = () => {
      if (!cur) return;
      const left = cur.dl.length ? { start: tl[cur.dl[0]].start, end: tl[cur.dl[cur.dl.length - 1]].end } : { start: anchor(tl, cur.at[0], l.bodyStart), end: anchor(tl, cur.at[0], l.bodyStart) };
      const right = cur.ir.length ? { start: tr[cur.ir[0]].start, end: tr[cur.ir[cur.ir.length - 1]].end } : { start: anchor(tr, cur.at[1], r.bodyStart), end: anchor(tr, cur.at[1], r.bodyStart) };
      out.push({ left, right });
      cur = null;
    };
    for (const e of o) {
      if (e.op === "eq") { flush(); continue; }
      cur ??= { dl: [], ir: [], at: [e.a, e.b] };
      if (e.op === "del") cur.dl.push(e.a); else cur.ir.push(e.b);
    }
    flush();
    return out;
  };

  let dels: Para[] = [], inss: Para[] = [];
  const flushHunk = () => {
    if (!dels.length && !inss.length) return;
    const pairs: [Para, Para][] = [];
    if (dels.length * inss.length <= limits.maxPairingCells) {
      let from = 0;
      for (const d of dels) {
        let best = -1, bestSim = limits.minSimilarity;
        for (let p = from; p < inss.length; p++) { const s = jaccard(sset("left", d), sset("right", inss[p])); if (s >= bestSim && (best < 0 || s > bestSim)) { best = p; bestSim = s; } }
        if (best >= 0) { pairs.push([d, inss[best]]); from = best + 1; }
      }
    }
    const pd = new Set(pairs.map(p => p[0].index)), pi = new Set(pairs.map(p => p[1].index));
    let di = 0, ii = 0;
    const emitFree = (maxL: number, maxR: number) => {
      while (di < dels.length && dels[di].index < maxL) { if (!pd.has(dels[di].index)) rows.push({ kind: "deleted", left: dels[di].index }); di++; }
      while (ii < inss.length && inss[ii].index < maxR) { if (!pi.has(inss[ii].index)) rows.push({ kind: "inserted", right: inss[ii].index }); ii++; }
    };
    for (const [l, r] of pairs) { emitFree(l.index, r.index); while (di < dels.length && dels[di].index <= l.index) di++; while (ii < inss.length && inss[ii].index <= r.index) ii++; rows.push({ kind: "changed", left: l.index, right: r.index, changes: wordChanges(l, r) }); }
    emitFree(Infinity, Infinity);
    dels = []; inss = [];
  };
  for (const e of ops) {
    if (e.op === "del") dels.push(L[e.a]);
    else if (e.op === "ins") inss.push(R[e.b]);
    else { flushHunk(); rows.push({ kind: labelKey(L[e.a].label) !== labelKey(R[e.b].label) ? "renumbered" : "equal", left: e.a, right: e.b }); }
  }
  flushHunk();

  // Moves: an unmatched deletion and an unmatched insertion with the same text (long enough to be meaningful).
  const freeIns = new Map<string, number[]>();
  rows.forEach((r, i) => { if (r.kind === "inserted" && R[r.right!].key.length >= 20) (freeIns.get(R[r.right!].key) ?? freeIns.set(R[r.right!].key, []).get(R[r.right!].key)!).push(i); });
  let moveId = 0;
  rows.forEach(r => {
    if (r.kind !== "deleted") return;
    const q = freeIns.get(L[r.left!].key);
    if (!q?.length) return;
    const other = rows[q.shift()!]; moveId++;
    r.kind = "moved"; r.moveId = moveId; other.kind = "moved"; other.moveId = moveId;
  });

  // ---- observations, in reading order
  const paraSrc = (side: Side, p: Para) => b.src(side, p.index, p.start, p.end);
  const labelSpan = (p: Para) => ({ start: p.start + (p.text.length - p.text.trimStart().length), end: p.bodyStart });
  const renumber = new Map<string, string>(), numOf = (l: string | null) => /\d+(?:\.\d+)*/.exec(l ?? "")?.[0] ?? null;
  const movedSeen = new Set<number>();
  const factObs = (type: FactType, lf: Fact | null, rf: Fact | null, lp: Para | null, rp: Para | null) => {
    const name = TYPE_NAME[type], check = type === "amount" ? CHECK.value : type === "percent" ? CHECK.percent : type === "deadline" ? CHECK.deadline : CHECK.date;
    const sources: Source[] = [];
    if (lf && lp) sources.push(b.src("left", lp.index, lf.start, lf.end));
    if (rf && rp) sources.push(b.src("right", rp.index, rf.start, rf.end));
    if (lf && rf) {
      const days = type === "date" ? dayDiff(lf.norm, rf.norm) : null;
      b.add({ kind: "value-changed", severity: "attention", title: `${name} alterado: "${lf.raw}" → "${rf.raw}"`, sources, check, ...(days !== null ? { detail: `Diferença de ${days} dia(s) entre as datas, se ambas estiverem no formato dia/mês/ano.` } : {}) });
    } else if (rf) b.add({ kind: "value-added", severity: "attention", title: `${name} incluído: "${rf.raw}"`, sources, check: `${check} ${CHECK.added}` });
    else if (lf) b.add({ kind: "value-removed", severity: "attention", title: `${name} retirado: "${lf.raw}"`, sources, check: `${check} ${CHECK.removed}` });
  };
  const ambiguity = (side: Side, p: Para, facts: Fact[]) => {
    for (const f of facts) for (const a of f.ambiguity) b.add({ kind: "ambiguous", severity: "attention", title: `${TYPE_NAME[f.type]} ambíguo(a): "${f.raw}"`, sources: [b.src(side, p.index, f.start, f.end)], check: a });
  };
  const factsOf = (p: Para) => extractFacts(p.body, p.bodyStart);

  for (const row of rows) {
    const l = row.left !== undefined ? L[row.left] : null, r = row.right !== undefined ? R[row.right] : null;
    if (row.kind === "renumbered" && l && r) {
      const ls = labelSpan(l), rs = labelSpan(r);
      b.add({ kind: "renumbered", severity: "info", title: `Numeração alterada: "${l.label?.trim() ?? ""}" → "${r.label?.trim() ?? ""}"`, sources: [b.src("left", l.index, ls.start, ls.end), b.src("right", r.index, rs.start, rs.end)], check: CHECK.renumbered });
      const a = numOf(l.label), c = numOf(r.label); if (a && c && a !== c) renumber.set(a, c);
    } else if (row.kind === "inserted" && r) {
      b.add({ kind: "inserted", severity: "attention", title: "Trecho incluído", sources: [paraSrc("right", r)], check: CHECK.inserted });
      for (const f of factsOf(r)) factObs(f.type, null, f, null, r);
      ambiguity("right", r, factsOf(r));
    } else if (row.kind === "deleted" && l) {
      b.add({ kind: "deleted", severity: "attention", title: "Trecho excluído", sources: [paraSrc("left", l)], check: CHECK.deleted });
      for (const f of factsOf(l)) factObs(f.type, f, null, l, null);
      ambiguity("left", l, factsOf(l));
    } else if (row.kind === "moved" && l) {
      if (movedSeen.has(row.moveId!)) continue;
      movedSeen.add(row.moveId!);
      const other = rows.find(x => x !== row && x.moveId === row.moveId)!;
      b.add({ kind: "moved", severity: "info", title: "Trecho com o mesmo texto em outra posição", sources: [paraSrc("left", l), paraSrc("right", R[other.right!])], check: CHECK.moved });
    } else if (row.kind === "moved" && r && !movedSeen.has(row.moveId!)) {
      movedSeen.add(row.moveId!);
      const other = rows.find(x => x !== row && x.moveId === row.moveId)!;
      b.add({ kind: "moved", severity: "info", title: "Trecho com o mesmo texto em outra posição", sources: [paraSrc("left", L[other.left!]), paraSrc("right", r)], check: CHECK.moved });
    } else if (row.kind === "changed" && l && r) {
      const changes = row.changes ?? [];
      if (labelKey(l.label) !== labelKey(r.label)) {
        const ls = labelSpan(l), rs = labelSpan(r);
        b.add({ kind: "renumbered", severity: "info", title: `Numeração alterada: "${l.label?.trim() ?? ""}" → "${r.label?.trim() ?? ""}"`, sources: [b.src("left", l.index, ls.start, ls.end), b.src("right", r.index, rs.start, rs.end)], check: CHECK.renumbered });
        const a = numOf(l.label), c = numOf(r.label); if (a && c && a !== c) renumber.set(a, c);
      }
      changes.slice(0, limits.maxChangesPerParagraph).forEach(c => {
        const sources: Source[] = [];
        if (c.left && c.left.end > c.left.start) sources.push(b.src("left", l.index, c.left.start, c.left.end));
        if (c.right && c.right.end > c.right.start) sources.push(b.src("right", r.index, c.right.start, c.right.end));
        if (!sources.length) return;
        const q = (s: Source | undefined) => (s ? `"${s.quote.length > 60 ? s.quote.slice(0, 57) + "…" : s.quote}"` : "(nada)");
        const ls = sources.find(s => s.side === "left"), rs = sources.find(s => s.side === "right");
        b.add({ kind: "changed", severity: "attention", title: `Texto alterado: ${q(ls)} → ${q(rs)}`, sources, check: CHECK.changed });
      });
      if (changes.length > limits.maxChangesPerParagraph) b.add({ kind: "changed", severity: "attention", title: `Mais ${changes.length - limits.maxChangesPerParagraph} alteração(ões) neste parágrafo`, sources: [paraSrc("left", l), paraSrc("right", r)], check: CHECK.changed });
      const lf = factsOf(l), rf = factsOf(r), { leftRest, rightRest } = factPairs(lf, rf);
      for (const type of ["amount", "percent", "deadline", "date"] as FactType[]) {
        const a = leftRest.filter(f => f.type === type), c = rightRest.filter(f => f.type === type);
        for (let i = 0; i < Math.max(a.length, c.length); i++) factObs(type, a[i] ?? null, c[i] ?? null, l, r);
      }
      // Ambiguity matters where the text changed; flag it on whichever side still carries it.
      ambiguity("left", l, leftRest.filter(f => f.ambiguity.length)); ambiguity("right", r, rightRest.filter(f => f.ambiguity.length));
    }
  }

  // Cross references to clauses whose number changed. "Conferir", never "errado": the new numbering may be fine.
  if (renumber.size) {
    // Body only: a clause's own heading ("CLÁUSULA 3.") is not a reference to it.
    for (const p of R) for (const m of p.body.matchAll(/cl[áa]usulas?\s+(\d+(?:\.\d+)*)/gi)) {
      const to = renumber.get(m[1]); if (!to) continue;
      const start = p.bodyStart + m.index! + m[0].length - m[1].length;
      b.add({ kind: "cross-reference", severity: "attention", title: `Referência à cláusula ${m[1]}, que foi renumerada para ${to}`, sources: [b.src("right", p.index, start, start + m[1].length)], check: CHECK.crossref });
    }
  }

  const stats = { equal: 0, changed: 0, deleted: 0, inserted: 0, renumbered: 0, moved: 0 };
  for (const r of rows) stats[r.kind]++;
  const notes = [
    "Comparação textual determinística e local. Não interpreta efeitos jurídicos: cada observação indica o que conferir nos documentos originais.",
    "Diferenças só de espaçamento, quebra de linha ou maiúsculas/minúsculas iniciais da numeração são ignoradas.",
    "O texto vem da extração do arquivo (DOCX/PDF/ODT/TXT); a fidelidade em relação ao documento original não é garantida (tabelas, cabeçalhos, imagens e alterações controladas podem não aparecer).",
  ];
  if (b.truncated) notes.push(`Mostrando as primeiras ${limits.maxObservations} observações; há mais diferenças. Compare por partes.`);
  return { status: "ok", left: { sha256: sha(leftText), length: leftText.length, paragraphs: L.map(view) }, right: { sha256: sha(rightText), length: rightText.length, paragraphs: R.map(view) }, rows, observations: b.list, stats, truncated: b.truncated, notes };
}
