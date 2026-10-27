#!/usr/bin/env node
// Builds the separate LawyerMind language pack (spelling dictionaries for the bundled editors).
//   node build-pack.mjs --target windows|linux|macos|payload --out <dir>
// The editors already read Hunspell dictionaries from standard per-user/system folders, so the pack only places
// the files there:  Windows %LOCALAPPDATA%\hunspell  ·  macOS /Library/Spelling  ·  Linux /usr/share/hunspell.
// Needs: makensis (windows), dpkg-deb (linux), pkgbuild (macos, macOS runner only).
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(here, "languages.json"), "utf8"));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const target = arg("--target") ?? "payload";
const out = path.resolve(arg("--out") ?? path.join(here, "dist"));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const stage = path.join(out, "stage");
const payload = path.join(stage, "payload"); // dictionaries/
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(payload, "dictionaries"), { recursive: true });
fs.mkdirSync(path.join(payload, "licencas"), { recursive: true });

for (const lang of cfg.languages) {
  for (const [name, want] of Object.entries(lang.files)) {
    const { repoRaw, sha: rev, dir } = lang.source;
    const res = await fetch(`${repoRaw}/${rev}/${dir}/${name}`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (sha(bytes) !== want) throw new Error(`${name}: SHA-256 diferente do fixado`);
    fs.writeFileSync(path.join(payload, "dictionaries", name), bytes);
  }
  for (const rel of lang.licenseFiles) fs.copyFileSync(path.resolve(here, rel), path.join(payload, "licencas", `${lang.id}-${path.basename(rel)}`));
}
const names = cfg.languages.map((l) => l.name).join(", ");
fs.writeFileSync(path.join(payload, "LEIA-ME.txt"), `Pacote de idiomas do LawyerMind ${cfg.version}\n\nInstala dicionários do corretor ortográfico: ${names}.\nOs dicionários não foram modificados; as licenças estão em "licencas".\nAs traduções da interface dos editores ficam dentro de cada editor e não fazem parte deste pacote.\n`);
const dictFiles = fs.readdirSync(path.join(payload, "dictionaries")).sort();
const base = `LawyerMind-Idiomas_${cfg.version}`;
fs.mkdirSync(out, { recursive: true });

if (target === "payload") { console.log(`payload em ${payload}: ${dictFiles.join(", ")}`); process.exit(0); }

if (target === "windows") {
  // Per-user (no administrator): files go to %LOCALAPPDATA%\hunspell, shared with other Hunspell programs; the
  // uninstaller removes only the files this pack installed.
  const dicts = dictFiles.map((f) => `  File "/oname=${f}" "${path.join(payload, "dictionaries", f).replace(/\//g, "\\")}"`).join("\n");
  const del = dictFiles.map((f) => `  Delete "$LOCALAPPDATA\\hunspell\\${f}"`).join("\n");
  const lic = fs.readdirSync(path.join(payload, "licencas")).map((f) => `  File "${path.join(payload, "licencas", f).replace(/\//g, "\\")}"`).join("\n");
  const nsi = `Unicode true
!define VERSION "${cfg.version}"
Name "LawyerMind - Pacote de idiomas"
OutFile "${path.join(out, `${base}_windows.exe`).replace(/\//g, "\\")}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\\LawyerMind-Idiomas"
SetCompressor /SOLID lzma
VIProductVersion "${cfg.version}.0"
VIAddVersionKey "ProductName" "LawyerMind - Pacote de idiomas"
VIAddVersionKey "FileVersion" "${cfg.version}"
VIAddVersionKey "LegalCopyright" "Dicionários sob suas próprias licenças (ver licencas)"
Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles
Section "Dicionarios"
  SetOutPath "$LOCALAPPDATA\\hunspell"
${dicts}
  SetOutPath "$INSTDIR\\licencas"
${lic}
  SetOutPath "$INSTDIR"
  File "${path.join(payload, "LEIA-ME.txt").replace(/\//g, "\\")}"
  WriteUninstaller "$INSTDIR\\desinstalar.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LawyerMindIdiomas" "DisplayName" "LawyerMind - Pacote de idiomas"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LawyerMindIdiomas" "DisplayVersion" "\${VERSION}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LawyerMindIdiomas" "UninstallString" '"$INSTDIR\\desinstalar.exe"'
SectionEnd
Section "Uninstall"
${del}
  RMDir /r "$INSTDIR\\licencas"
  Delete "$INSTDIR\\LEIA-ME.txt"
  Delete "$INSTDIR\\desinstalar.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LawyerMindIdiomas"
SectionEnd
`;
  const file = path.join(stage, "pack.nsi");
  fs.writeFileSync(file, "\uFEFF" + nsi, "utf8");
  run("makensis", ["-V2", file]);
  console.log(`ok: ${path.join(out, `${base}_windows.exe`)}`);
} else if (target === "linux") {
  const root = path.join(stage, "deb");
  const dict = path.join(root, "usr", "share", "hunspell"), doc = path.join(root, "usr", "share", "doc", "lawyermind-idiomas");
  fs.mkdirSync(dict, { recursive: true }); fs.mkdirSync(doc, { recursive: true }); fs.mkdirSync(path.join(root, "DEBIAN"), { recursive: true });
  for (const f of dictFiles) fs.copyFileSync(path.join(payload, "dictionaries", f), path.join(dict, f));
  for (const f of fs.readdirSync(path.join(payload, "licencas"))) fs.copyFileSync(path.join(payload, "licencas", f), path.join(doc, f));
  fs.copyFileSync(path.join(payload, "LEIA-ME.txt"), path.join(doc, "LEIA-ME.txt"));
  fs.writeFileSync(path.join(root, "DEBIAN", "control"), `Package: lawyermind-idiomas
Version: ${cfg.version}
Section: text
Priority: optional
Architecture: all
Maintainer: LawyerMind <nao-responda@lawyermind.invalid>
Provides: hunspell-dictionary, hunspell-dictionary-pt-br
Replaces: hunspell-pt-br
Conflicts: hunspell-pt-br
Description: LawyerMind - pacote de idiomas (corretor ortográfico)
 Dicionarios Hunspell (${names}) para os editores do LawyerMind.
 Nao modificados; licencas em /usr/share/doc/lawyermind-idiomas.
`);
  run("dpkg-deb", ["--root-owner-group", "--build", root, path.join(out, `${base}_all.deb`)]);
  console.log(`ok: ${path.join(out, `${base}_all.deb`)}`);
} else if (target === "macos") {
  const root = path.join(stage, "pkgroot");
  fs.mkdirSync(path.join(root, "LawyerMind-Idiomas"), { recursive: true });
  for (const f of dictFiles) fs.copyFileSync(path.join(payload, "dictionaries", f), path.join(root, f));
  fs.cpSync(path.join(payload, "licencas"), path.join(root, "LawyerMind-Idiomas", "licencas"), { recursive: true });
  fs.copyFileSync(path.join(payload, "LEIA-ME.txt"), path.join(root, "LawyerMind-Idiomas", "LEIA-ME.txt"));
  run("pkgbuild", ["--root", root, "--identifier", "br.mblz.lawyermind.idiomas", "--version", cfg.version, "--install-location", "/Library/Spelling", path.join(out, `${base}_macos.pkg`)]);
  console.log(`ok: ${path.join(out, `${base}_macos.pkg`)}`);
} else throw new Error(`alvo desconhecido: ${target}`);
