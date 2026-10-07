// Pure document-review state machine. Contract content is inert data; no tools,
// network, credentials, HTML execution or shell capability is exposed here.
export type Clause = { id: string; text: string };
export type Fixture = { id: string; name: string; format: "DOCX" | "PDF"; file: string; fileSha256: string; clauses: Clause[]; replacement: string };
export type Anchor = { clauseId: string; start: number; end: number; quote: string; textSha256: string };
export type Proposal = { id: string; anchor: Anchor; replacement: string; reason: string; status: "pending" | "accepted" | "rejected" | "conflict" };
export type Snapshot = { format: "lawyermind-review-pilot-v1"; simulation: true; sourceId: string; sourceSha256: string; representedParty: string; objective: string; text: string; textSha256: string; parentSha256: string | null; decisions: Proposal[]; opinion: string; sha256: string };
export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export function sourceText(fixture: Fixture): string { return fixture.clauses.map(c => c.text).join("\n\n"); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export async function beginReview(fixture: Fixture, party: string, objective: string, consent: boolean) {
  if (!consent || !party.trim() || !objective.trim()) throw Error("Informe a parte representada, o objetivo e o consentimento para a simulação local.");
  if (party.length > 200 || objective.length > 2000) throw Error("Contexto muito longo.");
  const text = sourceText(fixture);
  return { fixture, party: party.trim(), objective: objective.trim(), text, textSha256: await sha256(text), proposals: [] as Proposal[], parentSha256: null as string | null };
}
export type Review = Awaited<ReturnType<typeof beginReview>>;
export async function simulateProposal(review: Review, clauseId: string, question: string): Promise<Proposal> {
  if (!question.trim() || question.length > 2000) throw Error("Escreva a pergunta sobre a cláusula.");
  const clause = review.fixture.clauses.find(c => c.id === clauseId);
  if (!clause) throw Error("Cláusula não encontrada.");
  if (clauseId !== "clausula-2") throw Error("Esta cláusula não possui proposta predefinida no piloto.");
  // Offsets refer to the exact current text, never fuzzy matches or substring guesses.
  const start = review.text.indexOf(clause.text);
  if (start < 0 || review.text.indexOf(clause.text, start + 1) >= 0) throw Error("Conflito: a cláusula mudou ou aparece mais de uma vez. Abra uma nova revisão.");
  return { id: crypto.randomUUID(), anchor: { clauseId, start, end: start + clause.text.length, quote: clause.text, textSha256: review.textSha256 }, replacement: review.fixture.replacement,
    reason: `SIMULAÇÃO predefinida. Parte: ${review.party}. Objetivo: ${review.objective}. Pergunta registrada: ${question}. Sem pesquisa jurídica ou resposta de IA real.`, status: "pending" };
}
export async function decide(review: Review, proposalId: string, decision: "accepted" | "rejected"): Promise<Review> {
  const proposal = review.proposals.find(p => p.id === proposalId);
  if (!proposal || proposal.status !== "pending") throw Error("Esta proposta não está pendente.");
  const next = structuredClone(review);
  const selected = next.proposals.find(p => p.id === proposalId)!;
  if (decision === "rejected") { selected.status = "rejected"; return next; }
  const a = selected.anchor;
  if (a.textSha256 !== review.textSha256 || review.text.slice(a.start, a.end) !== a.quote) {
    selected.status = "conflict"; return next;
  }
  next.text = review.text.slice(0, a.start) + selected.replacement + review.text.slice(a.end);
  next.textSha256 = await sha256(next.text); selected.status = "accepted";
  // Pending proposals from the old snapshot must be re-anchored explicitly.
  next.proposals.forEach(p => { if (p.status === "pending") p.status = "conflict"; });
  return next;
}
export function opinion(review: Review): string {
  return ["PARECER SIMULADO — documento fictício; não é revisão jurídica por IA.", `Parte representada: ${review.party}`, `Objetivo: ${review.objective}`,
    ...review.proposals.map(p => `${p.anchor.clauseId}: ${p.status}. Trecho exato: ${p.anchor.quote}\nProposta: ${p.replacement}`),
    "Sem verificação de legislação, jurisprudência, validade ou suficiência jurídica. Revisão profissional permanece necessária."].join("\n\n");
}
export async function snapshot(review: Review): Promise<Snapshot> {
  if (review.proposals.some(p => p.status === "pending" || p.status === "conflict")) throw Error("Resolva ou descarte propostas pendentes e conflitos antes de salvar.");
  const body = { format: "lawyermind-review-pilot-v1" as const, simulation: true as const, sourceId: review.fixture.id, sourceSha256: review.fixture.fileSha256,
    representedParty: review.party, objective: review.objective, text: review.text, textSha256: await sha256(review.text), parentSha256: review.parentSha256,
    decisions: structuredClone(review.proposals), opinion: opinion(review) };
  return freeze({ ...body, sha256: await sha256(JSON.stringify(body)) });
}
export async function verifySnapshot(value: Snapshot): Promise<boolean> {
  const { sha256: expected, ...body } = value;
  return expected === await sha256(JSON.stringify(body)) && body.textSha256 === await sha256(body.text);
}
