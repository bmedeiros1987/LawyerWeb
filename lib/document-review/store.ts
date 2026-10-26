import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DesktopError, desktopStateDir } from "../desktop/env";
import { containedPath, ensureContainedDir, openContained, realDir } from "../desktop/paths";
import { fixtures } from "./fixtures";
import { sha256, sourceText, verifySnapshot, opinion, type Snapshot } from "./model";

// Future real-provider adapter deliberately has no network implementation,
// account discovery, environment credentials, gateway URL or fallback model.
export const providerStatus = Object.freeze({ provider: "ChatGPT via OpenClaw local", connected: false, enabled: false, reason: "Integração local ainda não validada nem autorizada. Nenhum documento será enviado." });
export async function requestRealReview(): Promise<never> { throw new DesktopError(providerStatus.reason, 503, "provider-disconnected"); }

export async function validatePilotSnapshot(value: Snapshot) {
  const fixture = fixtures.find(f => f.id === value.sourceId);
  if (!fixture || value.format !== "lawyermind-review-pilot-v1" || value.simulation !== true) throw new DesktopError("Somente contratos fictícios do piloto são aceitos.", 400);
  // Verify source bytes too, not a guessed or metadata-only hash.
  const file = path.join(process.cwd(), "public", fixture.file);
  const bytes = fs.readFileSync(file);
  if (await sha256(bytes) !== fixture.fileSha256 || value.sourceSha256 !== fixture.fileSha256) throw new DesktopError("Conflito: o contrato de origem mudou.", 409, "source-conflict");
  if (!await verifySnapshot(value)) throw new DesktopError("Snapshot ou hash inválido.", 422, "checksum");
  if (!value.representedParty.trim() || !value.objective.trim() || value.representedParty.length > 200 || value.objective.length > 2000) throw new DesktopError("Informe parte e objetivo.", 400);
  const original = sourceText(fixture), originalHash = await sha256(original);
  const clause = fixture.clauses.find(c => c.id === "clausula-2")!, start = original.indexOf(clause.text);
  let accepted = 0;
  for (const p of value.decisions) {
    const a = p.anchor;
    if (a.clauseId !== clause.id || a.start !== start || a.end !== start + clause.text.length || a.quote !== clause.text || a.textSha256 !== originalHash || p.replacement !== fixture.replacement) throw new DesktopError("Âncora ou proposta não corresponde à simulação.", 409, "anchor-conflict");
    if (p.status === "accepted") accepted++;
    if (p.status === "pending" || p.status === "conflict") throw new DesktopError("Resolva ou descarte as propostas pendentes/conflitantes antes de salvar.", 409, "unresolved");
  }
  if (accepted > 1) throw new DesktopError("Propostas sobrepostas.", 409, "overlap");
  const expected = accepted ? original.slice(0, start) + fixture.replacement + original.slice(start + clause.text.length) : original;
  const expectedOpinion = opinion({ fixture, party: value.representedParty, objective: value.objective, text: value.text, textSha256: value.textSha256, proposals: value.decisions, parentSha256: value.parentSha256 });
  if (value.opinion !== expectedOpinion) throw new DesktopError("O parecer não corresponde ao registro simulado.", 422, "opinion-conflict");
  if (value.text !== expected) throw new DesktopError("O texto não corresponde às decisões explícitas.", 409, "text-conflict");
}

/** Saves a new immutable review JSON. Never writes the DOCX/PDF source.
 * Immutability is enforced by exclusive creation + containment and byte hashes,
 * not an OS/WORM guarantee against other processes or the account owner.
 */
export async function savePilotSnapshot(userId: string, workspaceId: string, reviewId: string, value: Snapshot) {
  if (!/^[a-f0-9-]{36}$/.test(reviewId) || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new DesktopError("Identificador inválido.", 400);
  await validatePilotSnapshot(value);
  const state = realDir(desktopStateDir());
  const scope = crypto.createHash("sha256").update(JSON.stringify([userId, workspaceId])).digest("hex");
  const root = ensureContainedDir(state, `review-pilot/${scope}/${reviewId}`);
  if (value.parentSha256) {
    if (!/^[a-f0-9]{64}$/.test(value.parentSha256)) throw new DesktopError("Versão anterior inválida.", 400);
    const { fd } = openContained(root, `${value.parentSha256}.json`);
    let parent: Snapshot;
    try { parent = JSON.parse(fs.readFileSync(fd, "utf8")); } finally { fs.closeSync(fd); }
    if (!await verifySnapshot(parent) || parent.sha256 !== value.parentSha256 || parent.sourceId !== value.sourceId || parent.sourceSha256 !== value.sourceSha256) throw new DesktopError("Conflito na versão anterior.", 409, "parent-conflict");
  }
  const target = containedPath(root, `${value.sha256}.json`, "absent");
  const fd = fs.openSync(target, "wx", 0o400);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); }
  catch (error) { fs.closeSync(fd); fs.rmSync(target, { force: true }); throw error; }
  fs.closeSync(fd);
  // POSIX directory fsync closes the filename durability gap. Do not claim
  // equivalent Windows/drive-controller crash guarantees from this operation.
  if (process.platform !== "win32") {
    const dir = fs.openSync(root, "r"); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  }
  return { saved: true, snapshotSha256: value.sha256, sourceSha256: value.sourceSha256, format: "JSON de revisão; DOCX/PDF original preservado", simulation: true };
}
