#!/usr/bin/env node
// Downloads the PostgreSQL server binaries for the target platform from the npm
// registry (@embedded-postgres/<platform>, built from zonky.io's
// embedded-postgres-binaries), verifies the pinned SHA-512, and lays them out in
// src-tauri/resources/postgres/{bin,lib,share} so Tauri bundles them with the app.
//
// Usage: node scripts/prepare-postgres.mjs [--target linux-x64|linux-arm64|darwin-arm64|darwin-x64|windows-x64]
//
// Runs at build time only. The packaged app never downloads anything.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "18.4.0-beta.17"; // PostgreSQL 18.4
const INTEGRITY = {
  "linux-x64": "sha512-jVw/MdDtIX/vICH/DKIe6/mHpiCggdx6QVyza4vt/NbcZFsL0KhwglF6F1Koqx3gRBZ9XtN+vi63EsqSyqOSxA==",
  "linux-arm64": "sha512-TIzjtGnDGSD/LbdW0OWCEcbI+YVT0WKSfSr20TCkkP4UR8zeKe+QCZbO0/CM4hS9EWyZ4cDebjRvpRc3iMi6wg==",
  "darwin-arm64": "sha512-Kg1ZMNFzkVIJs3g4V2UYEc5X005km9rGinxFBH8R1sOU2Rblvz4pt2Uf93Pu8Rk273Ue9HIdrbMPpgUqwjUi0Q==",
  "darwin-x64": "sha512-4tShSYWMxUQTSWoQAdLnHISvRj6L9gTch9/31ASJPg6wgyN64LDRwMcOINEWybM7N0ropJ3nTYhFT3UX1bKY5Q==",
  "windows-x64": "sha512-AwRerliA4IGWyW5jWBvHt5vidVUSB0QQW9Tt2y7ScnmifnCb/awfxZr4BkBSTv+gNt8Djcddqs+xSF5Z6/CkTg==",
};

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const out = path.join(desktop, "src-tauri", "resources", "postgres");
const cache = path.join(desktop, ".cache", "postgres");

function hostTarget() {
  const plat = { linux: "linux", darwin: "darwin", win32: "windows" }[process.platform];
  const arch = { x64: "x64", arm64: "arm64" }[process.arch];
  if (!plat || !arch) throw new Error(`plataforma não suportada: ${process.platform}-${process.arch}`);
  return `${plat}-${arch}`;
}

const argTarget = process.argv.indexOf("--target");
const target = argTarget > 0 ? process.argv[argTarget + 1] : hostTarget();
if (!INTEGRITY[target]) throw new Error(`alvo desconhecido: ${target}`);
const pkg = `@embedded-postgres/${target}`;
const stamp = path.join(out, "VERSION.json");

if (fs.existsSync(stamp)) {
  const current = JSON.parse(fs.readFileSync(stamp, "utf8"));
  if (current.target === target && current.version === VERSION) {
    console.log(`PostgreSQL ${VERSION} (${target}) já preparado em ${out}`);
    process.exit(0);
  }
}

fs.mkdirSync(cache, { recursive: true });
const tgzName = `embedded-postgres-${target}-${VERSION}.tgz`;
const tgz = path.join(cache, tgzName);
if (!fs.existsSync(tgz)) {
  console.log(`Baixando ${pkg}@${VERSION} do registro npm…`);
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", `${pkg}@${VERSION}`, "--pack-destination", cache], {
    stdio: ["ignore", "ignore", "inherit"],
    shell: process.platform === "win32",
  });
}
const digest = "sha512-" + createHash("sha512").update(fs.readFileSync(tgz)).digest("base64");
if (digest !== INTEGRITY[target]) {
  fs.rmSync(tgz);
  throw new Error(`integridade divergente para ${tgzName}: ${digest}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lawyermind-pg-"));
extractTgz(tgz, tmp);
const native = path.join(tmp, "package", "native");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const dir of ["bin", "lib", "share"]) {
  const src = path.join(native, dir);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(out, dir), { recursive: true, verbatimSymlinks: false });
}

// The npm package stores symlinks in a JSON file; materialize them as copies
// (bundlers do not reliably preserve symlinks).
const links = path.join(native, "pg-symlinks.json");
if (fs.existsSync(links)) {
  for (const { source, target: link } of JSON.parse(fs.readFileSync(links, "utf8"))) {
    const from = path.join(out, path.relative("native", source));
    const to = path.join(out, path.relative("native", link));
    // Unversioned Linux development links (libfoo.so) are not used at runtime; on
    // macOS the binaries load the unversioned libfoo.dylib names, so keep those.
    if (/^lib[^.]+\.so$/.test(path.basename(to))) continue;
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}

// Static libraries and headers are not needed at runtime.
function prune(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "include" || e.name === "pkgconfig") fs.rmSync(p, { recursive: true, force: true });
      else prune(p);
    } else if (e.name.endsWith(".a") || e.name.endsWith(".lib")) {
      fs.rmSync(p);
    }
  }
}
prune(path.join(out, "lib"));

// The Windows binaries are built with MSVC and need VCRUNTIME140.dll, which a
// clean Windows install may not have. Ship the redistributable copy next to them
// (app-local deployment of the Visual C++ runtime).
if (target.startsWith("windows")) {
  const dll = findVcRuntime();
  if (!dll) throw new Error("VCRUNTIME140.dll não encontrado (instale as Build Tools do Visual Studio)");
  fs.copyFileSync(dll, path.join(out, "bin", "vcruntime140.dll"));
  console.log(`vcruntime140.dll copiado de ${dll}`);
}

if (process.platform !== "win32") {
  for (const f of fs.readdirSync(path.join(out, "bin"))) fs.chmodSync(path.join(out, "bin", f), 0o755);
}

fs.copyFileSync(path.join(tmp, "package", "LICENSE.md"), path.join(out, "LICENSE-embedded-postgres.md"));
fs.writeFileSync(
  path.join(out, "README.txt"),
  "PostgreSQL server binaries (PostgreSQL License) packaged by zonky.io embedded-postgres-binaries\n" +
    `and distributed on npm as ${pkg}@${VERSION}. Used only as a local server bound to 127.0.0.1.\n`,
);
fs.writeFileSync(stamp, JSON.stringify({ target, version: VERSION, package: pkg, integrity: INTEGRITY[target] }, null, 2));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`PostgreSQL ${VERSION} (${target}) preparado em ${out}`);

function findVcRuntime() {
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const vswhere = path.join(pf86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  const roots = [];
  if (fs.existsSync(vswhere)) {
    try {
      const r = execFileSync(vswhere, ["-latest", "-products", "*", "-property", "installationPath"], { encoding: "utf8" }).trim();
      if (r) roots.push(...r.split(/\r?\n/));
    } catch {}
  }
  for (const root of roots) {
    const redist = path.join(root, "VC", "Redist", "MSVC");
    if (!fs.existsSync(redist)) continue;
    const versions = fs.readdirSync(redist).filter((v) => /^\d/.test(v)).sort().reverse();
    for (const v of versions) {
      const x64 = path.join(redist, v, "x64");
      if (!fs.existsSync(x64)) continue;
      for (const crt of fs.readdirSync(x64).filter((d) => /^Microsoft\.VC\d+\.CRT$/.test(d))) {
        const dll = path.join(x64, crt, "vcruntime140.dll");
        if (fs.existsSync(dll)) return dll;
      }
    }
  }
  return null;
}

// Minimal .tgz extractor (regular files and directories, ustar + GNU/PAX long names),
// so the build does not depend on which `tar` is on PATH (Windows).
function extractTgz(file, dest) {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  let off = 0;
  let longName = null;
  const str = (b) => b.toString("utf8").replace(/\0.*$/s, "");
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    let name = str(h.subarray(0, 100));
    const prefix = str(h.subarray(345, 500));
    if (prefix) name = prefix + "/" + name;
    const size = parseInt(str(h.subarray(124, 136)).trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 48);
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = str(body); continue; }
    if (type === "x") {
      const m = /\d+ path=([^\n]*)\n/.exec(body.toString("utf8"));
      if (m) longName = m[1];
      continue;
    }
    if (type === "g") continue;
    if (longName) { name = longName; longName = null; }
    const target = path.resolve(dest, name);
    if (!target.startsWith(path.resolve(dest) + path.sep)) throw new Error(`entrada fora do destino: ${name}`);
    if (type === "5") fs.mkdirSync(target, { recursive: true });
    else if (type === "0" || type === "\0" || type === "7") {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
    }
  }
}
