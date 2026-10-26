#!/usr/bin/env node
// Prepares (never publishes) a LawyerMind update from REAL build artifacts.
//
//   node --experimental-strip-types scripts/release/prepare-release.mjs \
//        --tag v0.2.0 --artifacts <dir> --notes <notes.md> --pubkey <minisign.pub> --channel test|production --out <dir>
//
// It only reads local files and writes into --out. No network, no upload, no tag, no push, no signing, no key
// generation. Channels:
//   test        unsigned/CI builds for review. Produces a report only. It NEVER writes `update-manifest.json`, the
//               asset the app reads to offer an update, so a test build can never be announced as available.
//   production  writes `update-manifest.json` only when every gate passes: versions agree, hashes match
//               SHA256SUMS.txt, updater signatures verify, notes are filled in, and per-platform evidence shows the
//               installed build passed its tests and is code-signed (Windows) / signed and notarized (macOS).
// The result is for a person to review and attach to a release by hand.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { parsePublicKey, parseSignature, verifySignature } from "../../lib/desktop/minisign.ts";
import { MANIFEST_ASSET, MANIFEST_SCHEMA, TARGETS, packageUrlFor, parseManifest } from "../../lib/desktop/update-manifest.ts";

export const DEFAULT_REQUIRED = ["windows-x86_64", "darwin-aarch64"];
const SEMVER_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PLACEHOLDER = /\b(TODO|TBD|A PREENCHER|PREENCHER|XXX|lorem ipsum)\b/i;

const evidenceSchema = z.object({
  target: z.enum(TARGETS), version: z.string(), builtFrom: z.string().regex(/^[0-9a-f]{40}$/), runUrl: z.string().url().optional(),
  tests: z.object({ installedSelfTest: z.enum(["pass", "fail", "not-run"]), upgradeFromPrevious: z.enum(["pass", "fail", "not-run"]), uninstallKeepsData: z.enum(["pass", "fail", "not-run"]) }).strict(),
  signing: z.object({ codeSigned: z.boolean(), notarized: z.boolean().optional() }).strict(),
}).strict();

const sha256File = file => { const h = crypto.createHash("sha256"), fd = fs.openSync(file, "r"), buf = Buffer.alloc(1 << 20); try { for (;;) { const n = fs.readSync(fd, buf, 0, buf.length); if (!n) break; h.update(buf.subarray(0, n)); } } finally { fs.closeSync(fd); } return h.digest("hex"); };

/** Maps an installer file name to its update target, or null when it cannot be decided without guessing. */
export function targetOfInstaller(name) {
  const lower = name.toLowerCase();
  if (/-setup\.exe$/.test(lower) && /(x64|x86_64|amd64)/.test(lower)) return "windows-x86_64";
  if (/\.dmg$/.test(lower)) {
    const arm = /(aarch64|arm64)/.test(lower), intel = /(x86_64|x64|amd64|intel)/.test(lower);
    if (arm && !intel) return "darwin-aarch64";
    if (intel && !arm) return "darwin-x86_64";
  }
  return null;
}

export function checkVersions(root, tag) {
  const problems = [];
  if (!SEMVER_TAG.test(tag)) return [`Tag "${tag}" inválida: use vMAJOR.MINOR.PATCH, sem sufixo de pré-lançamento.`];
  const want = tag.slice(1);
  const cargo = fs.readFileSync(path.join(root, "desktop/Cargo.toml"), "utf8");
  const cargoVersion = /\[workspace\.package\][^[]*?\bversion\s*=\s*"([^"]+)"/s.exec(cargo)?.[1];
  const tauri = JSON.parse(fs.readFileSync(path.join(root, "desktop/src-tauri/tauri.conf.json"), "utf8")).version;
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "desktop/package.json"), "utf8")).version;
  for (const [where, got] of [["desktop/Cargo.toml [workspace.package]", cargoVersion], ["desktop/src-tauri/tauri.conf.json", tauri], ["desktop/package.json", pkg]])
    if (got !== want) problems.push(`${where} está em ${got ?? "?"}, a tag pede ${want}.`);
  return problems;
}

function readSums(file) {
  const map = new Map();
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim()); if (m) map.set(m[2].trim(), m[1].toLowerCase()); }
  return map;
}

export function prepare({ root, tag, artifacts, notesFile, pubkeyFile, channel, out, required = DEFAULT_REQUIRED, now = () => new Date() }) {
  const failures = [], warnings = [];
  const fail = m => failures.push(m);
  if (channel !== "test" && channel !== "production") return { ok: false, failures: ["--channel deve ser test ou production."], warnings, written: [] };
  for (const p of checkVersions(root, tag)) fail(p);
  const version = tag.replace(/^v/, "");

  // Artifacts: exactly one installer per target, hashed from the bytes on disk.
  const sums = fs.existsSync(path.join(artifacts, "SHA256SUMS.txt")) ? readSums(path.join(artifacts, "SHA256SUMS.txt")) : null;
  if (!sums) fail("SHA256SUMS.txt ausente na pasta de artefatos.");
  const found = new Map();
  for (const name of fs.readdirSync(artifacts)) {
    if (!fs.statSync(path.join(artifacts, name)).isFile()) continue;
    if (!/\.(exe|dmg)$/i.test(name)) continue;
    const target = targetOfInstaller(name);
    if (!target) { fail(`Não foi possível determinar a plataforma/arquitetura de "${name}" (nome ambíguo). Nada foi adivinhado.`); continue; }
    if (found.has(target)) { fail(`Mais de um instalador para ${target}: "${found.get(target).name}" e "${name}".`); continue; }
    found.set(target, { name, file: path.join(artifacts, name) });
  }
  for (const t of required) if (!found.has(t)) fail(`Sem instalador real para ${t}.`);
  if (!found.size) fail("Nenhum instalador (.exe/.dmg) encontrado.");

  let pub = null;
  try { pub = parsePublicKey(fs.readFileSync(pubkeyFile, "utf8")); }
  catch (e) {
    if (channel === "production") fail(`Chave pública do atualizador ausente ou inválida: ${e.message}`);
    else warnings.push("Sem chave pública do atualizador: nenhuma assinatura foi verificada (aceitável só no canal test).");
  }

  const entries = [], rows = [];
  for (const [target, a] of found) {
    const row = { target, name: a.name, size: 0, sha256: "", signature: "ausente", evidence: "ausente", signing: "?" };
    rows.push(row);
    const stat = fs.statSync(a.file); row.size = stat.size;
    row.sha256 = sha256File(a.file);
    if (sums && sums.get(a.name) !== row.sha256) fail(`SHA-256 de "${a.name}" não confere com SHA256SUMS.txt.`);
    const sigFile = `${a.file}.sig`;
    let sigText = null;
    if (fs.existsSync(sigFile)) {
      sigText = fs.readFileSync(sigFile, "utf8").trim();
      try {
        const sig = parseSignature(sigText);
        const msg = sig.algorithm === "ED" ? { blake2b512: crypto.createHash("blake2b512").update(fs.readFileSync(a.file)).digest() } : { bytes: fs.readFileSync(a.file) };
        if (!pub) row.signature = "não verificada (sem chave pública)";
        else if (verifySignature(pub, sig, msg)) row.signature = "válida";
        else { row.signature = "INVÁLIDA"; fail(`Assinatura do atualizador de "${a.name}" não confere com a chave pública.`); }
      } catch (e) { row.signature = "ilegível"; fail(`Assinatura de "${a.name}" ilegível: ${e.message}`); }
    } else if (channel === "production") fail(`Sem arquivo de assinatura "${a.name}.sig".`);
    else warnings.push(`${target}: sem assinatura do atualizador ("${a.name}.sig"); aceitável só no canal test, nunca anunciável.`);
    // Platform evidence: tests that ran on that platform, and how it is signed.
    const evFile = path.join(artifacts, "evidence", `${target}.json`);
    if (!fs.existsSync(evFile)) { if (channel === "production") fail(`Sem evidência de testes/assinatura para ${target} (evidence/${target}.json).`); else warnings.push(`${target}: sem evidence/${target}.json; os testes por plataforma não estão registrados.`); }
    else {
      const ev = evidenceSchema.safeParse(JSON.parse(fs.readFileSync(evFile, "utf8")));
      if (!ev.success) fail(`Evidência de ${target} malformada.`);
      else {
        const e = ev.data; row.evidence = "presente";
        row.signing = e.signing.codeSigned ? (target.startsWith("darwin") ? (e.signing.notarized ? "assinado+notarizado" : "assinado, SEM notarização") : "assinado") : "NÃO assinado";
        if (e.target !== target) fail(`Evidência de ${target} declara o alvo ${e.target}.`);
        if (e.version !== version) fail(`Evidência de ${target} é da versão ${e.version}, não ${version}.`);
        if (channel === "production") {
          const t = e.tests;
          for (const k of ["installedSelfTest", "upgradeFromPrevious", "uninstallKeepsData"]) if (t[k] !== "pass") fail(`${target}: teste "${k}" não passou (${t[k]}). Sem aprovação por plataforma, nada é anunciado.`);
          if (!e.signing.codeSigned) fail(`${target}: instalador sem assinatura de código/editor; não é build de produção.`);
          if (target.startsWith("darwin") && !e.signing.notarized) fail(`${target}: sem notarização da Apple; não é build de produção.`);
        } else warnings.push(`${target}: canal "test": ${row.signing}; testes ${Object.values(e.tests).join("/")}.`);
        row.builtFrom = e.builtFrom;
      }
    }
    entries.push({ target, a, sigText, size: stat.size, sha: row.sha256 });
  }
  const commits = new Set(rows.map(r => r.builtFrom).filter(Boolean));
  if (commits.size > 1) fail(`Instaladores construídos de commits diferentes: ${[...commits].join(", ")}.`);

  let notes = "";
  try { notes = fs.readFileSync(notesFile, "utf8").trim(); } catch { fail("Notas de versão ausentes."); }
  if (notes && (notes.length < 40 || PLACEHOLDER.test(notes))) fail("Notas de versão vazias, curtas demais ou ainda com texto a preencher (TODO/A PREENCHER).");

  const written = [];
  fs.mkdirSync(out, { recursive: true });
  const write = (name, text) => { fs.writeFileSync(path.join(out, name), text); written.push(name); };
  const report = [
    `# Relatório de preparação — ${tag} (${channel})`, "",
    `Gerado em ${now().toISOString()}. **Isto não é uma publicação.** Nada foi enviado, assinado, tag­ueado ou anunciado.`, "",
    `Resultado: ${failures.length ? "**NÃO APROVADO**" : channel === "production" ? "aprovado para revisão humana e publicação manual" : "build de TESTE (nunca anunciável)"}`, "",
    "| Plataforma | Arquivo | Tamanho | SHA-256 | Assinatura do atualizador | Evidência | Assinatura de código |", "|---|---|---|---|---|---|---|",
    ...rows.map(r => `| ${r.target} | ${r.name} | ${r.size} | \`${r.sha256}\` | ${r.signature} | ${r.evidence} | ${r.signing} |`), "",
    `Alvos sem instalador (não serão oferecidos): ${TARGETS.filter(t => !found.has(t)).join(", ") || "nenhum"}.`, "",
    ...(failures.length ? ["## Bloqueios", ...failures.map(f => `- ${f}`), ""] : []), ...(warnings.length ? ["## Avisos", ...warnings.map(f => `- ${f}`), ""] : []),
  ].join("\n");
  write(`release-report-${channel}.md`, report);

  if (!failures.length && channel === "production") {
    const manifest = {
      schema: MANIFEST_SCHEMA, version, notes, pubDate: now().toISOString(), minimumInstalledVersion: "0.1.0",
      platforms: Object.fromEntries(entries.map(e => [e.target, { name: e.a.name, url: packageUrlFor(tag, e.a.name), size: e.size, sha256: e.sha, signature: Buffer.from(e.sigText).toString("base64") }])),
    };
    try { parseManifest(manifest, tag); } catch (e) { fail(`O manifesto gerado não passou na validação do aplicativo: ${e.message}`); }
    if (!failures.length) {
      write(MANIFEST_ASSET, JSON.stringify(manifest, null, 2) + "\n");
      write("SHA256SUMS.txt", entries.map(e => `${e.sha}  ${e.a.name}`).join("\n") + "\n");
    }
  } else if (channel === "test") {
    write("NOT-ANNOUNCEABLE.txt", `Build de teste de ${tag}. Não existe ${MANIFEST_ASSET} para este canal, então o aplicativo nunca o oferecerá como atualização.\n`);
  }
  return { ok: failures.length === 0, failures, warnings, written, rows };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]?.startsWith("--") ? "true" : all[i + 1] ?? "true"]] : acc), []));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  if (args["check-versions"]) { const p = checkVersions(args.root ?? root, args.tag ?? ""); console.log(p.length ? p.join("\n") : "versões consistentes"); process.exit(p.length ? 1 : 0); }
  const need = ["tag", "artifacts", "notes", "channel", "out", ...(args.channel === "production" ? ["pubkey"] : [])].filter(k => !args[k]);
  if (need.length) { console.error(`Faltam: ${need.map(n => "--" + n).join(" ")}`); process.exit(2); }
  const r = prepare({ root: args.root ?? root, tag: args.tag, artifacts: path.resolve(args.artifacts), notesFile: path.resolve(args.notes), pubkeyFile: path.resolve(args.pubkey ?? "/nonexistent-pubkey"), channel: args.channel, out: path.resolve(args.out), required: args.require ? args.require.split(",") : DEFAULT_REQUIRED });
  for (const f of r.failures) console.error("BLOQUEIO:", f);
  for (const w of r.warnings) console.log("aviso:", w);
  console.log(r.ok ? `ok (${args.channel}): ${r.written.join(", ")}` : "NÃO APROVADO: nada foi liberado.");
  process.exit(r.ok ? 0 : 1);
}
