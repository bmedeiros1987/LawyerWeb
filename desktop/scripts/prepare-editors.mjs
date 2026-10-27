#!/usr/bin/env node
// Lays out src-tauri/resources/editors/ for the installer:
//   lawyermind-pdf[.exe], lawyermind-word[.exe]   only if LAWYERMIND_EDITORS_FROM points to a folder that has them
//   LICENSES/                                     licenses, NOTICE and attributions of the upstream editors (always shipped)
// Without the binaries the installer is built with no embedded editors and the app says so (it never fakes them).
// Usage: LAWYERMIND_EDITORS_FROM=<dir> node scripts/prepare-editors.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(desktop, "src-tauri", "resources", "editors");
const exe = process.platform === "win32" ? ".exe" : "";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

fs.cpSync(path.join(desktop, "editors", "LICENSES"), path.join(out, "LICENSES"), { recursive: true });

const from = process.env.LAWYERMIND_EDITORS_FROM;
const shipped = [];
if (from) {
  for (const name of ["lawyermind-pdf", "lawyermind-word"]) {
    const src = path.join(from, name + exe);
    if (!fs.existsSync(src)) { console.warn(`Editor ausente em ${from}: ${name + exe} (não será incluído).`); continue; }
    fs.copyFileSync(src, path.join(out, name + exe));
    fs.chmodSync(path.join(out, name + exe), 0o755);
    shipped.push(name);
  }
}
fs.writeFileSync(path.join(out, "LEIA-ME.txt"), shipped.length
  ? `Editores embutidos neste instalador: ${shipped.join(", ")}. Código-fonte, licenças e alterações: docs/EDITORS.md do LawyerMind e a pasta LICENSES.\n`
  : "Este instalador foi gerado sem editores embutidos.\n");
console.log(shipped.length ? `Editores incluídos: ${shipped.join(", ")}` : "Nenhum editor incluído (LAWYERMIND_EDITORS_FROM não informado ou vazio).");
