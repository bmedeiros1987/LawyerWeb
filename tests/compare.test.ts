// Synthetic contracts only. Deterministic text comparison: inclusion, exclusion, renumbering, values, deadlines,
// ambiguous dates, moved clauses, limits and invariants. No network, no AI, no real documents.
import { describe, expect, it } from "vitest";
import { COMPARE_LIMITS, compareTexts, type CompareResult, type Observation } from "@/lib/compare/compare";
import { extensoToNumber, extractFacts } from "@/lib/compare/facts";
import { diffSequences, TooDifferent } from "@/lib/compare/myers";
import { paragraphs, splitLabel } from "@/lib/compare/text";

const ok = (r: CompareResult) => { if (r.status !== "ok") throw new Error("expected ok, got " + r.status + ": " + r.message); return r; };
const kinds = (o: Observation[]) => o.map(x => x.kind);
/** Every quoted span must be the literal slice of its own side, and cover real text. */
function assertQuotes(left: string, right: string, r: CompareResult) {
  const res = ok(r);
  for (const o of res.observations) {
    expect(o.check.length).toBeGreaterThan(10);
    expect(o.sources.length).toBeGreaterThan(0);
    for (const s of o.sources) {
      const text = s.side === "left" ? left : right;
      expect(s.quote).toBe(text.slice(s.start, s.end));
      expect(s.end).toBeGreaterThan(s.start);
    }
  }
}
function assertCoverage(r: CompareResult) {
  const res = ok(r), l = new Map<number, number>(), q = new Map<number, number>();
  for (const row of res.rows) { if (row.left !== undefined) l.set(row.left, (l.get(row.left) ?? 0) + 1); if (row.right !== undefined) q.set(row.right, (q.get(row.right) ?? 0) + 1); }
  expect([...l.values()].every(n => n === 1) && l.size === res.left.paragraphs.length).toBe(true);
  expect([...q.values()].every(n => n === 1) && q.size === res.right.paragraphs.length).toBe(true);
}

const BASE = [
  "CONTRATO DE PRESTAÇÃO DE SERVIÇOS",
  "CLÁUSULA 1. O objeto deste contrato é a prestação de serviços de consultoria.",
  "CLÁUSULA 2. O valor mensal é de R$ 10.000,00 (dez mil reais), com reajuste anual de 5%.",
  "CLÁUSULA 3. O pagamento será feito em 30 (trinta) dias úteis após a emissão da nota fiscal.",
  "CLÁUSULA 4. Conforme a cláusula 3, o atraso gera multa de 2%.",
  "CLÁUSULA 5. A rescisão exige aviso prévio de 60 dias.",
  "CLÁUSULA 6. Fica eleito o foro da comarca de São Paulo.",
].join("\n");

describe("structure", () => {
  it("identical texts: nothing to report", () => {
    const r = ok(compareTexts(BASE, BASE));
    expect(r.observations).toEqual([]);
    expect(r.stats).toMatchObject({ equal: 7, changed: 0, deleted: 0, inserted: 0, renumbered: 0 });
    assertCoverage(r);
  });

  it("spacing, blank lines and CRLF are ignored; a changed capital letter is not", () => {
    expect(ok(compareTexts(BASE, BASE.replace(/\n/g, "\r\n\r\n").replace("O objeto", "O   objeto"))).observations).toEqual([]);
    expect(kinds(ok(compareTexts(BASE, BASE.replace("O objeto", "O Objeto"))).observations)).toEqual(["changed"]);
  });

  it("inclusion: a new clause is reported with its exact text on the right side only", () => {
    const right = BASE.replace("CLÁUSULA 6.", "CLÁUSULA 6. As partes manterão sigilo sobre as informações trocadas.\nCLÁUSULA 7.");
    const r = ok(compareTexts(BASE, right));
    const ins = r.observations.filter(o => o.kind === "inserted");
    expect(ins).toHaveLength(1);
    expect(ins[0].sources).toHaveLength(1);
    expect(ins[0].sources[0]).toMatchObject({ side: "right", quote: "CLÁUSULA 6. As partes manterão sigilo sobre as informações trocadas." });
    assertQuotes(BASE, right, r); assertCoverage(r);
  });

  it("exclusion: a removed clause is reported with its exact text on the left side only", () => {
    const right = BASE.replace(/CLÁUSULA 5\..*\n/, "");
    const r = ok(compareTexts(BASE, right));
    const del = r.observations.filter(o => o.kind === "deleted");
    expect(del).toHaveLength(1);
    expect(del[0].sources[0]).toMatchObject({ side: "left", quote: "CLÁUSULA 5. A rescisão exige aviso prévio de 60 dias." });
    assertQuotes(BASE, right, r); assertCoverage(r);
  });

  it("renumbering: shifted numbers are 'renumbered', not changed, and stale cross references are flagged for checking", () => {
    const right = BASE
      .replace("CLÁUSULA 2.", "CLÁUSULA 2. Os serviços serão prestados por equipe dedicada.\nCLÁUSULA 3.")
      .replace("CLÁUSULA 3. O pagamento", "CLÁUSULA 4. O pagamento").replace("CLÁUSULA 4. Conforme", "CLÁUSULA 5. Conforme")
      .replace("CLÁUSULA 5. A rescisão", "CLÁUSULA 6. A rescisão").replace("CLÁUSULA 6. Fica", "CLÁUSULA 7. Fica");
    const r = ok(compareTexts(BASE, right));
    expect(r.stats.inserted).toBe(1);
    expect(r.stats.renumbered).toBeGreaterThanOrEqual(4);
    expect(r.observations.filter(o => o.kind === "changed")).toEqual([]);
    const ren = r.observations.find(o => o.kind === "renumbered" && o.title.startsWith('Numeração alterada: "CLÁUSULA 3."'));
    expect(ren?.sources.map(s => s.quote)).toEqual(["CLÁUSULA 3.", "CLÁUSULA 4."]);
    const xr = r.observations.find(o => o.kind === "cross-reference");
    expect(xr?.title).toMatch(/cláusula 3, que foi renumerada para 4/);
    expect(xr?.sources[0].quote).toBe("3");
    assertQuotes(BASE, right, r); assertCoverage(r);
  });

  it("a clause moved elsewhere is one 'moved' observation with both positions", () => {
    const lines = BASE.split("\n"), moved = lines.splice(6, 1)[0];
    const right = [lines[0], moved, ...lines.slice(1)].join("\n");
    const r = ok(compareTexts(BASE, right));
    const mv = r.observations.filter(o => o.kind === "moved");
    expect(mv).toHaveLength(1);
    expect(mv[0].sources.map(s => s.side).sort()).toEqual(["left", "right"]);
    assertQuotes(BASE, right, r); assertCoverage(r);
  });

  it("word-level change inside a clause points at the exact words on both sides", () => {
    const right = BASE.replace("prestação de serviços de consultoria", "prestação de serviços de auditoria");
    const r = ok(compareTexts(BASE, right)), ch = r.observations.filter(o => o.kind === "changed");
    expect(ch).toHaveLength(1);
    expect(ch[0].sources.map(s => [s.side, s.quote])).toEqual([["left", "consultoria"], ["right", "auditoria"]]);
    assertQuotes(BASE, right, r);
  });

  it("pure insertion/deletion of a word inside a clause has a single-sided source", () => {
    const r1 = ok(compareTexts(BASE, BASE.replace("Fica eleito o foro", "Fica expressamente eleito o foro")));
    expect(r1.observations.find(o => o.kind === "changed")?.sources.map(s => [s.side, s.quote])).toEqual([["right", "expressamente"]]);
    const r2 = ok(compareTexts(BASE.replace("Fica eleito", "Fica expressamente eleito"), BASE));
    expect(r2.observations.find(o => o.kind === "changed")?.sources.map(s => [s.side, s.quote])).toEqual([["left", "expressamente"]]);
  });

  it("PDF-style text with form feeds keeps the page of each source", () => {
    const left = "CLÁUSULA 1. Objeto do contrato.\fCLÁUSULA 2. Prazo de 10 dias.";
    const right = "CLÁUSULA 1. Objeto do contrato.\fCLÁUSULA 2. Prazo de 15 dias.";
    const o = ok(compareTexts(left, right)).observations.find(x => x.kind === "value-changed")!;
    expect(o.sources.map(s => s.page)).toEqual([2, 2]);
  });
});

describe("values, deadlines and dates", () => {
  const cmp = (a: string, b: string) => { const r = compareTexts(BASE.replace(a, a), BASE.replace(a, b)); assertQuotes(BASE, BASE.replace(a, b), r); return ok(r).observations; };

  it("amount change quotes both amounts", () => {
    const o = cmp("R$ 10.000,00 (dez mil reais)", "R$ 12.000,00 (doze mil reais)").find(x => x.kind === "value-changed" && x.title.startsWith("Valor"))!;
    expect(o.title).toBe('Valor alterado: "R$ 10.000,00" → "R$ 12.000,00"');
    expect(o.sources.map(s => s.quote)).toEqual(["R$ 10.000,00", "R$ 12.000,00"]);
    expect(o.check).toMatch(/Conferir/);
  });
  it("percent change", () => expect(cmp("reajuste anual de 5%", "reajuste anual de 7%").find(x => x.title.startsWith("Percentual"))?.sources.map(s => s.quote)).toEqual(["5%", "7%"]));
  it("deadline change, same unit", () => expect(cmp("30 (trinta) dias úteis", "45 (quarenta e cinco) dias úteis").find(x => x.title.startsWith("Prazo alterado"))?.title).toBe('Prazo alterado: "30 (trinta) dias úteis" → "45 (quarenta e cinco) dias úteis"'));
  it("a value added or removed is its own observation", () => {
    expect(kinds(cmp("com reajuste anual de 5%", "com reajuste anual de 5% e multa de R$ 500,00"))).toContain("value-added");
    expect(kinds(cmp("com reajuste anual de 5%", "com reajuste"))).toContain("value-removed");
  });
  it("number and written-out number that disagree are flagged for checking", () => {
    const o = cmp("30 (trinta) dias úteis", "30 (vinte) dias úteis");
    expect(o.some(x => x.kind === "ambiguous" && /divergem/.test(x.check))).toBe(true);
  });
  it("days without 'úteis' or 'corridos' are flagged as ambiguous", () => {
    const o = cmp("aviso prévio de 60 dias", "aviso prévio de 90 dias").filter(x => x.kind === "ambiguous");
    expect(o.map(x => x.check)).toEqual([expect.stringMatching(/úteis ou corridos/), expect.stringMatching(/úteis ou corridos/)]);
    expect(o.map(x => x.sources[0].quote)).toEqual(["60 dias", "90 dias"]); // both sides of the compared value carry the ambiguity
  });
  it("ambiguous numeric dates: day/month both ≤ 12, two-digit year, impossible date", () => {
    const f = (t: string) => extractFacts(t).filter(x => x.type === "date");
    expect(f("em 03/04/2025")[0]).toMatchObject({ norm: "2025-04-03", ambiguity: [expect.stringMatching(/dia\/mês ou mês\/dia/)] });
    expect(f("em 25/04/2025")[0].ambiguity).toEqual([]);
    expect(f("em 25/04/25")[0].ambiguity).toEqual([expect.stringMatching(/2 dígitos/)]);
    expect(f("em 31/02/2025")[0].ambiguity).toEqual([expect.stringMatching(/inexistente/)]);
    expect(f("em 5 de março de 2025")[0]).toMatchObject({ norm: "2025-03-05", ambiguity: [] });
    expect(f("em 2025-03-05")[0]).toMatchObject({ norm: "2025-03-05", ambiguity: [] });
    expect(f("em 29 de fevereiro de 2023")[0].ambiguity).toEqual([expect.stringMatching(/inexistente/)]);
    expect(f("em 29 de fevereiro de 2024")[0].ambiguity).toEqual([]);
  });
  it("date change reports the day difference only when both dates are well defined", () => {
    const left = "CLÁUSULA 1. Entrega em 5 de março de 2025.", right = "CLÁUSULA 1. Entrega em 10 de março de 2025.";
    expect(ok(compareTexts(left, right)).observations.find(o => o.kind === "value-changed")?.detail).toMatch(/5 dia/);
    const amb = ok(compareTexts("CLÁUSULA 1. Entrega em 03/04/2025.", "CLÁUSULA 1. Entrega em 04/04/2025.")).observations;
    expect(amb.find(o => o.kind === "value-changed")?.detail).toMatch(/1 dia/); // both parse; ambiguity is flagged separately
    expect(amb.some(o => o.kind === "ambiguous")).toBe(true);
  });
  it("amount formats: Brazilian vs American vs dotted decimal", () => {
    const a = (t: string) => extractFacts(t).filter(x => x.type === "amount")[0];
    expect(a("R$ 1.234,56")).toMatchObject({ norm: "123456", ambiguity: [] });
    expect(a("R$ 1234")).toMatchObject({ norm: "123400", ambiguity: [] });
    expect(a("R$ 1,234.56").ambiguity[0]).toMatch(/americano/);
    expect(a("R$ 1.5").ambiguity[0]).toMatch(/decimal ou milhar/);
    expect(a("1.000,00 reais")).toMatchObject({ norm: "100000" });
  });
  it("unchanged values are not reported", () => expect(kinds(cmp("Fica eleito o foro da comarca de São Paulo", "Fica eleito o foro da comarca do Rio"))).toEqual(["changed"]));
  it("extenso parsing", () => {
    expect([extensoToNumber("trinta"), extensoToNumber("quarenta e cinco"), extensoToNumber("cento e vinte"), extensoToNumber("duzentos e um"), extensoToNumber("xyz")]).toEqual([30, 45, 120, 201, null]);
  });
});

describe("labels and text structure", () => {
  it.each([["CLÁUSULA 5. Texto", "CLÁUSULA 5."], ["1.1. Texto", "1.1."], ["1.1 Texto", "1.1"], ["a) Texto", "a)"], ["I - Texto", "I -"], ["Art. 3º Texto", "Art. 3º"], ["§ 2º Texto", "§ 2º"]])("label of %j", (t, label) => expect(splitLabel(t).label?.trim()).toBe(label));
  it.each(["12 meses após a assinatura", "Mas a parte poderá", "R$ 1.000,00 serão pagos", "Da rescisão", "1.000,00 reais", "Eu"])("%j is not a label", t => expect(splitLabel(t).label).toBeNull());
  it("paragraph offsets slice back to the original, including accents and CRLF", () => {
    const t = "CLÁUSULA 1. Ação\r\n\r\nCLÁUSULA 2. Rescisão — ‘texto’\n";
    for (const p of paragraphs(t)) expect(t.slice(p.start, p.end)).toBe(p.text);
  });
});

describe("limits and robustness", () => {
  it("refuses texts over the size limit with an honest message", () => {
    const big = "a".repeat(COMPARE_LIMITS.maxChars + 1);
    expect(compareTexts(big, "x")).toMatchObject({ status: "too-large", message: expect.stringMatching(/Compare por partes/) });
    expect(compareTexts("x", big).status).toBe("too-large");
  });
  it("refuses too many paragraphs", () => expect(compareTexts("x\n".repeat(7000), "y").status).toBe("too-large"));
  it("refuses an alignment that would exceed the edit-distance cap, instead of guessing", () => {
    const a = Array.from({ length: 300 }, (_, i) => `par A${i}`).join("\n"), b = Array.from({ length: 300 }, (_, i) => `par B${i}`).join("\n");
    expect(compareTexts(a, b, { ...COMPARE_LIMITS, maxParagraphEdits: 50 }).status).toBe("too-different");
    expect(() => diffSequences([1, 2, 3], [4, 5, 6], 2)).toThrow(TooDifferent);
  });
  it("caps the observation list and says so", () => {
    const a = Array.from({ length: 50 }, (_, i) => `CLÁUSULA ${i + 1}. Prazo de ${i + 1} dias úteis.`).join("\n");
    const b = Array.from({ length: 50 }, (_, i) => `CLÁUSULA ${i + 1}. Prazo de ${i + 100} dias úteis.`).join("\n");
    const r = ok(compareTexts(a, b, { ...COMPARE_LIMITS, maxObservations: 10 }));
    expect(r.observations).toHaveLength(10); expect(r.truncated).toBe(true); expect(r.notes.join(" ")).toMatch(/primeiras 10/);
  });
  it("clips very long quotes but keeps them literal slices", () => {
    const long = "palavra ".repeat(400), l = `CLÁUSULA 1. ${long}`, r = "CLÁUSULA 1. outra";
    const res = ok(compareTexts(l, r)), s = res.observations.flatMap(o => o.sources).find(x => x.clipped)!;
    expect(s.quote).toHaveLength(COMPARE_LIMITS.maxQuote); expect(s.quote).toBe(l.slice(s.start, s.end));
  });
  it("is deterministic: same input, byte-identical output", () => {
    const right = BASE.replace("R$ 10.000,00", "R$ 11.000,00").replace("CLÁUSULA 6.", "CLÁUSULA 6. Novo item.\nCLÁUSULA 7.");
    expect(JSON.stringify(compareTexts(BASE, right))).toBe(JSON.stringify(compareTexts(BASE, right)));
  });
  it("handles a large contract (3000 clauses, 40 edits) quickly", () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => `CLÁUSULA ${i + 1}. A parte ${i} obriga-se a entregar o item ${i} em ${(i % 30) + 1} dias úteis.`);
    const a = mk(3000), b = [...a]; for (let k = 0; k < 40; k++) b[k * 70] = b[k * 70].replace("entregar", "receber");
    const t = Date.now(), r = ok(compareTexts(a.join("\n"), b.join("\n")));
    expect(Date.now() - t).toBeLessThan(3000);
    expect(r.stats.changed).toBe(40); assertCoverage(r);
  });
});

describe("invariants under random edits (seeded)", () => {
  const rng = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const WORDS = ["parte", "prazo", "multa", "valor", "serviço", "pagamento", "contrato", "rescisão", "foro", "sigilo", "R$ 1.000,00", "30 dias", "5%", "12/03/2025", "cláusula 2"];
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("seed %i: quotes are literal slices, every paragraph appears once, self-comparison is empty", seed => {
    const r = rng(seed), pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    const paras = Array.from({ length: 30 }, (_, i) => `CLÁUSULA ${i + 1}. ${Array.from({ length: 6 + Math.floor(r() * 8) }, () => pick(WORDS)).join(" ")}.`);
    const edited = paras.flatMap(p => { const x = r(); return x < 0.08 ? [] : x < 0.16 ? [p, `CLÁUSULA 99. ${pick(WORDS)} ${pick(WORDS)}.`] : x < 0.3 ? [p.replace(pick(WORDS), pick(WORDS))] : [p]; });
    const a = paras.join("\n"), b = edited.join("\n"), res = compareTexts(a, b);
    assertQuotes(a, b, res); assertCoverage(res);
    expect(ok(compareTexts(a, a)).observations).toEqual([]);
    expect(ok(compareTexts(b, b)).observations).toEqual([]);
  });
});
