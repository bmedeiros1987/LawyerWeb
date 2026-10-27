#!/usr/bin/env node
// Builds the derived PDF/Word editors from the pinned upstream commits, applying our patches
// (ArtCraft branding removed, updater and community links disabled). Output:
//   <out>/lawyermind-pdf[.exe], <out>/lawyermind-word[.exe]
// Usage: node build.mjs --out <dir> [--only pdf|word] [--work <dir>] [--fetch-only]
// Needs git and rustup (installs the pinned toolchain). Compiles upstream source: run it only where that is intended.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pins = JSON.parse(fs.readFileSync(path.join(here, "pins.json"), "utf8"));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const out = path.resolve(arg("--out") ?? path.join(here, "dist"));
const work = path.resolve(arg("--work") ?? fs.mkdtempSync(path.join(os.tmpdir(), "lm-editors-")));
const only = arg("--only");
const fetchOnly = process.argv.includes("--fetch-only"); // CI/test aid: stop after dependencies are fetched
const exe = process.platform === "win32" ? ".exe" : "";
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const cargo = (args, cwd, env = {}) => run("cargo", [`+${pins.rust}`, ...args], { cwd, env: { ...process.env, ...env } });

run("rustup", ["toolchain", "install", pins.rust, "--profile", "minimal"]);
fs.mkdirSync(out, { recursive: true });

// craft-libs rev edc41f6 (used by PdfCraft) has a manifest that Cargo >= 1.95 refuses
// ("`default-features = false` cannot override workspace's default-features"), which hides the
// crate. We remove that one override in the fetched copy; nothing else in the dependency changes.
function fixCraftMenu() {
  const base = path.join(process.env.CARGO_HOME ?? path.join(os.homedir(), ".cargo"), "git", "checkouts");
  if (!fs.existsSync(base)) return;
  for (const d of fs.readdirSync(base).filter((n) => n.startsWith("craft-libs-"))) {
    for (const rev of fs.readdirSync(path.join(base, d))) {
      const f = path.join(base, d, rev, "crates", "menu", "Cargo.toml");
      if (!fs.existsSync(f)) continue;
      const text = fs.readFileSync(f, "utf8");
      const fixed = text.replace("craft-keymap = { workspace = true, default-features = false,", "craft-keymap = { workspace = true,");
      if (fixed !== text) { fs.writeFileSync(f, fixed); console.log(`craft-menu: manifest ajustado em ${rev}`); }
    }
  }
}

// WordCraft embeds its interface translations at build time from a craft-i18n checkout (CRAFT_I18N_DIR).
// Without it the build is English only. We fetch the commit WordCraft pins, and drop the rows that mention
// the community server or the ArtCraft site (the copyright line NOTICE requires is kept).
function prepareI18n(wordSrc) {
  const rev = fs.readFileSync(path.join(wordSrc, "craft-i18n.rev"), "utf8").trim();
  if (rev !== pins.i18n.sha) throw new Error(`craft-i18n.rev (${rev}) diferente do fixado em pins.json (${pins.i18n.sha})`);
  const dir = path.join(work, "craft-i18n");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  run("git", ["init", "-q"], { cwd: dir });
  run("git", ["config", "core.autocrlf", "false"], { cwd: dir });
  run("git", ["fetch", "--depth", "1", pins.i18n.repo, pins.i18n.sha], { cwd: dir });
  run("git", ["checkout", "-q", "FETCH_HEAD"], { cwd: dir });
  let dropped = 0;
  const locales = path.join(dir, "locales");
  for (const loc of fs.readdirSync(locales)) {
    for (const f of ["wordcraft.tsv", "common.tsv"]) {
      const file = path.join(locales, loc, f);
      if (!fs.existsSync(file)) continue;
      const lines = fs.readFileSync(file, "utf8").split("\n");
      const kept = lines.filter((l) => !/discord|artcraft|getartcraft/i.test(l) || /Copyright \(c\) 2026 ArtCraft Team/.test(l));
      dropped += lines.length - kept.length;
      if (kept.length !== lines.length) fs.writeFileSync(file, kept.join("\n"));
    }
  }
  if (!fs.existsSync(path.join(locales, "pt-br", "wordcraft.tsv"))) throw new Error("craft-i18n sem locales/pt-br/wordcraft.tsv");
  console.log(`craft-i18n pronto (${dropped} linhas de marca/comunidade removidas)`);
  return dir;
}

async function fetchDictionary() {
  const d = pins.dictionary;
  const dest = path.join(out, "dictionaries");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const [name, want] of Object.entries(d.files)) {
    const res = await fetch(`${d.repoRaw}/${d.sha}/${d.dir}/${name}`);
    if (!res.ok) throw new Error(`dicionário ${name}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const got = crypto.createHash("sha256").update(bytes).digest("hex");
    if (got !== want) throw new Error(`dicionário ${name}: SHA-256 ${got} diferente do fixado ${want}`);
    fs.writeFileSync(path.join(dest, name), bytes);
  }
  console.log(`dicionário pt_BR verificado em ${dest}`);
}

if (!only || only === "word") await fetchDictionary();

for (const kind of ["pdf", "word"]) {
  if (only && only !== kind) continue;
  const pin = pins[kind];
  const src = path.join(work, pin.package);
  fs.rmSync(src, { recursive: true, force: true });
  fs.mkdirSync(src, { recursive: true });
  run("git", ["init", "-q"], { cwd: src });
  // Exact upstream bytes (no CRLF conversion on Windows) so our patches apply.
  run("git", ["config", "core.autocrlf", "false"], { cwd: src });
  run("git", ["config", "core.eol", "lf"], { cwd: src });
  run("git", ["fetch", "--depth", "1", pin.repo, pin.sha], { cwd: src });
  run("git", ["checkout", "-q", "FETCH_HEAD"], { cwd: src });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: src, encoding: "utf8" }).trim();
  if (head !== pin.sha) throw new Error(`${pin.package}: commit ${head} diferente do fixado ${pin.sha}`);

  const patchDir = path.join(here, "patches", pin.package);
  for (const p of fs.readdirSync(patchDir).filter((n) => n.endsWith(".patch")).sort()) {
    console.log(`aplicando ${pin.package}/${p}`);
    run("git", ["apply", "--check", path.join(patchDir, p)], { cwd: src });
    run("git", ["apply", path.join(patchDir, p)], { cwd: src });
  }
  // Brand assets are not open source (docs/brand/LICENSE-brand.txt): never part of the derivative.
  fs.rmSync(path.join(src, "docs", "brand"), { recursive: true, force: true });

  // The first fetch downloads the git checkouts and then fails on the craft-menu manifest; fix it and fetch again.
  try { cargo(["fetch", "--locked"], src); }
  catch { console.log("fetch falhou; ajustando o manifesto do craft-menu e tentando de novo"); fixCraftMenu(); cargo(["fetch", "--locked"], src); }
  fixCraftMenu();
  if (fetchOnly) { console.log(`ok: dependências de ${pin.package} baixadas`); continue; }
  // Target dir outside the sources so a CI cache survives the fresh checkout.
  const target = path.join(work, `target-${pin.package}`);
  const extraEnv = kind === "word" ? { CRAFT_I18N_DIR: prepareI18n(src), CRAFT_I18N_REQUIRED: "1" } : {};
  cargo(["build", "--release", "--locked", "-p", pin.package], src, { CARGO_TARGET_DIR: target, ...extraEnv });
  const built = path.join(target, "release", pin.binary + exe);
  if (!fs.existsSync(built)) throw new Error(`binário não gerado: ${built}`);
  fs.copyFileSync(built, path.join(out, pin.output + exe));
  console.log(`ok: ${path.join(out, pin.output + exe)}`);
}
