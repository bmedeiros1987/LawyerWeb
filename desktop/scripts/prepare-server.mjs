#!/usr/bin/env node
// Builds the web app as a self-contained production server (Next.js
// `output: "standalone"`, only when MBLZ_DESKTOP_BUILD=1) and lays out the
// installer resources:
//   src-tauri/resources/server/   server.js + traced node_modules + .next + public + prisma/migrations
//   src-tauri/resources/node/     the Node.js 22 runtime of this build machine (same OS/arch as the installer)
//   src-tauri/resources/runtime/  selftest.mjs (packaged acceptance test)
// Usage: node scripts/prepare-server.mjs [--skip-build]
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(desktop, "..");
const res = path.join(desktop, "src-tauri", "resources");

const major = Number(process.versions.node.split(".")[0]);
if (major !== 22) throw new Error(`Use Node.js 22 para gerar o instalador (atual: ${process.version}).`);

const server = path.join(res, "server");
if (!process.argv.includes("--skip-build")) {
  // Remove previous outputs first so the build trace cannot pick them up.
  fs.rmSync(server, { recursive: true, force: true });
  for (const t of ["debug", "release"]) {
    for (const d of ["server", "bundle"]) fs.rmSync(path.join(desktop, "target", t, d), { recursive: true, force: true });
  }
  console.log("Gerando o servidor Next.js de produção (standalone)…");
  execSync("npm run build", {
    cwd: repo, stdio: "inherit",
    env: { ...process.env, MBLZ_DESKTOP_BUILD: "1", NEXT_TELEMETRY_DISABLED: "1",
      // Only needed so the build can load modules; no connection is made.
      DATABASE_URL: "postgresql://build@127.0.0.1:1/build" },
  });
}

const standalone = path.join(repo, ".next", "standalone");
if (!fs.existsSync(path.join(standalone, "server.js"))) throw new Error("Build standalone ausente: rode sem --skip-build.");

fs.rmSync(server, { recursive: true, force: true });
fs.cpSync(standalone, server, { recursive: true, verbatimSymlinks: true });
// Turbopack links externals as `.next/node_modules/<pkg>-<hash>` symlinks.
// Installers do not carry symlinks reliably (and Windows needs privileges for
// them), so every symlink becomes a real copy of its target.
(function materialize(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) {
      const rel = fs.readlinkSync(path.join(standalone, path.relative(server, p)));
      const target = path.resolve(path.dirname(path.join(standalone, path.relative(server, p))), rel);
      fs.rmSync(p, { force: true, recursive: true });
      fs.cpSync(target, p, { recursive: true, dereference: true });
      console.log(`symlink materializado: ${path.relative(server, p)} -> ${path.relative(standalone, target)}`);
    } else if (e.isDirectory()) materialize(p);
  }
})(server);
fs.cpSync(path.join(repo, ".next", "static"), path.join(server, ".next", "static"), { recursive: true });
fs.cpSync(path.join(repo, "public"), path.join(server, "public"), { recursive: true });
for (const extra of ["desktop", "prisma"]) fs.rmSync(path.join(server, extra), { recursive: true, force: true });
fs.cpSync(path.join(repo, "prisma", "migrations"), path.join(server, "prisma", "migrations"), { recursive: true });
for (const f of [".env", ".env.local", ".env.production"]) fs.rmSync(path.join(server, f), { force: true });

const nodeDir = path.join(res, "node");
fs.rmSync(nodeDir, { recursive: true, force: true });
fs.mkdirSync(nodeDir, { recursive: true });
const nodeName = process.platform === "win32" ? "node.exe" : "node";
fs.copyFileSync(process.execPath, path.join(nodeDir, nodeName));
if (process.platform !== "win32") fs.chmodSync(path.join(nodeDir, nodeName), 0o755);
fs.writeFileSync(path.join(nodeDir, "README.txt"), `Node.js ${process.version} (${process.platform}-${process.arch}), MIT license, https://nodejs.org. Runs only the local LawyerMind server.\n`);

const runtime = path.join(res, "runtime");
fs.rmSync(runtime, { recursive: true, force: true });
fs.mkdirSync(runtime, { recursive: true });
fs.copyFileSync(path.join(desktop, "runtime", "selftest.mjs"), path.join(runtime, "selftest.mjs"));

let commit = "unknown";
try { commit = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
fs.writeFileSync(path.join(server, "BUILD.json"), JSON.stringify({ commit, node: process.version, platform: `${process.platform}-${process.arch}`, builtAt: new Date().toISOString() }, null, 2));

let files = 0, longest = 0;
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { files++; longest = Math.max(longest, path.relative(res, p).length); } } })(server);
console.log(`Servidor: ${files} arquivos (caminho relativo mais longo: ${longest} caracteres). Node ${process.version}. Commit ${commit}.`);
