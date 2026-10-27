#!/usr/bin/env node
// Builds the derived PDF/Word editors from the pinned upstream commits, applying our patches
// (ArtCraft branding removed, updater and community links disabled). Output:
//   <out>/lawyermind-pdf[.exe], <out>/lawyermind-word[.exe]
// Usage: node build.mjs --out <dir> [--only pdf|word] [--work <dir>]
// Needs git and rustup (installs the pinned toolchain). Compiles upstream source: run it only where that is intended.
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
const exe = process.platform === "win32" ? ".exe" : "";
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const cargo = (args, cwd, env = {}) => run("cargo", [`+${pins.rust}`, ...args], { cwd, env: { ...process.env, ...env } });

run("rustup", ["toolchain", "install", pins.rust, "--profile", "minimal"]);
fs.mkdirSync(out, { recursive: true });

// craft-libs rev edc41f6 (used by PdfCraft) has a manifest that Cargo >= 1.95 refuses
// ("`default-features = false` cannot override workspace's default-features"), which hides the
// crate. We remove that one override in the fetched copy; nothing else in the dependency changes.
function fixCraftMenu() {
  const base = path.join(os.homedir(), ".cargo", "git", "checkouts");
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

for (const kind of ["pdf", "word"]) {
  if (only && only !== kind) continue;
  const pin = pins[kind];
  const src = path.join(work, pin.package);
  fs.rmSync(src, { recursive: true, force: true });
  fs.mkdirSync(src, { recursive: true });
  run("git", ["init", "-q"], { cwd: src });
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

  cargo(["fetch", "--locked"], src);
  fixCraftMenu();
  // Target dir outside the sources so a CI cache survives the fresh checkout.
  const target = path.join(work, `target-${pin.package}`);
  cargo(["build", "--release", "--locked", "-p", pin.package], src, { CARGO_TARGET_DIR: target });
  const built = path.join(target, "release", pin.binary + exe);
  if (!fs.existsSync(built)) throw new Error(`binário não gerado: ${built}`);
  fs.copyFileSync(built, path.join(out, pin.output + exe));
  console.log(`ok: ${path.join(out, pin.output + exe)}`);
}
