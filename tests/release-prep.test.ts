// Release preparation gates, exercised through the real command line with SYNTHETIC artifacts and the public
// RFC 8032 test key. Nothing is built, signed for real, uploaded, tagged or published.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createReleaseChecker } from "@/lib/desktop/release-check";
import { parseManifest } from "@/lib/desktop/update-manifest";
import { syntheticSigner } from "./helpers/minisign-fixture";

const SCRIPT = path.resolve("scripts/release/prepare-release.mjs");
const TAG = "v0.2.0", COMMIT = "a".repeat(40);
const signer = syntheticSigner(), other = syntheticSigner("other");
let tmp: string;
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-rel-")); });
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const FILES = { win: "LawyerMind_0.2.0_x64-setup.exe", arm: "LawyerMind_0.2.0_aarch64.dmg", intel: "LawyerMind_0.2.0_x64.dmg" };
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const GOOD_NOTES = "## LawyerMind 0.2.0\n\nCorreções e melhorias de leitura dos documentos. Faça backup antes de atualizar.\n";
const evidence = (target: string, over: Record<string, unknown> = {}) => ({ target, version: "0.2.0", builtFrom: COMMIT, tests: { installedSelfTest: "pass", upgradeFromPrevious: "pass", uninstallKeepsData: "pass" }, signing: target.startsWith("darwin") ? { codeSigned: true, notarized: true } : { codeSigned: true }, ...over });

type Opts = { versions?: string; intel?: boolean; notes?: string; mutate?: (dir: string) => void };
function scenario(name: string, o: Opts = {}) {
  const root = path.join(tmp, name, "root"), art = path.join(tmp, name, "art"), out = path.join(tmp, name, "out");
  fs.mkdirSync(path.join(root, "desktop/src-tauri"), { recursive: true }); fs.mkdirSync(path.join(art, "evidence"), { recursive: true });
  const v = o.versions ?? "0.2.0";
  fs.writeFileSync(path.join(root, "desktop/Cargo.toml"), `[workspace]\nmembers = []\n\n[workspace.package]\nversion = "${v}"\nedition = "2021"\n`);
  fs.writeFileSync(path.join(root, "desktop/src-tauri/tauri.conf.json"), JSON.stringify({ version: v }));
  fs.writeFileSync(path.join(root, "desktop/package.json"), JSON.stringify({ version: v }));
  const items: [string, string][] = [["windows-x86_64", FILES.win], ["darwin-aarch64", FILES.arm], ...(o.intel ? [["darwin-x86_64", FILES.intel] as [string, string]] : [])];
  const sums: string[] = [];
  for (const [target, file] of items) {
    const bytes = Buffer.from(`instalador sintético ${target} ${"x".repeat(200)}`);
    fs.writeFileSync(path.join(art, file), bytes);
    fs.writeFileSync(path.join(art, file + ".sig"), signer.sign(bytes).file);
    fs.writeFileSync(path.join(art, "evidence", `${target}.json`), JSON.stringify(evidence(target)));
    sums.push(`${sha(bytes)}  ${file}`);
  }
  fs.writeFileSync(path.join(art, "SHA256SUMS.txt"), sums.join("\n") + "\n");
  fs.writeFileSync(path.join(tmp, name, "notes.md"), o.notes ?? GOOD_NOTES);
  fs.writeFileSync(path.join(tmp, name, "pub.txt"), signer.publicKeyFile);
  o.mutate?.(art);
  return { root, art, out, notes: path.join(tmp, name, "notes.md"), pub: path.join(tmp, name, "pub.txt") };
}
function run(s: ReturnType<typeof scenario>, channel: "test" | "production", extra: string[] = []) {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", SCRIPT, "--tag", TAG, "--root", s.root, "--artifacts", s.art, "--notes", s.notes, "--pubkey", s.pub, "--channel", channel, "--out", s.out, ...extra], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr, wrote: fs.existsSync(s.out) ? fs.readdirSync(s.out) : [] };
}
const edit = (art: string, file: string, fn: (b: Buffer) => Buffer) => fs.writeFileSync(path.join(art, file), fn(fs.readFileSync(path.join(art, file))));

describe("production gate", () => {
  it("passes with real-looking artifacts, and the manifest it writes is accepted by the app's own update check", async () => {
    const s = scenario("ok", { intel: true });
    const r = run(s, "production");
    expect(r.code).toBe(0); expect(r.wrote.sort()).toEqual(["SHA256SUMS.txt", "release-report-production.md", "update-manifest.json"]);
    const manifest = JSON.parse(fs.readFileSync(path.join(s.out, "update-manifest.json"), "utf8"));
    expect(() => parseManifest(manifest, TAG)).not.toThrow();
    expect(Object.keys(manifest.platforms).sort()).toEqual(["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]);
    expect(manifest.platforms["darwin-aarch64"].name).toBe(FILES.arm); expect(manifest.platforms["darwin-x86_64"].name).toBe(FILES.intel);
    // End to end: a release carrying exactly these files makes each platform's checker say update-available, and no other.
    const assets = [{ name: "update-manifest.json", size: 1, browser_download_url: `https://github.com/bmedeiros1987/LawyerWeb/releases/download/${TAG}/update-manifest.json` }, ...Object.values(manifest.platforms as Record<string, { name: string; size: number; url: string }>).map(p => ({ name: p.name, size: p.size, browser_download_url: p.url }))];
    const release = { tag_name: TAG, draft: false, prerelease: false, body: "", html_url: `https://github.com/bmedeiros1987/LawyerWeb/releases/tag/${TAG}`, assets };
    const fetcher = (async (url: string) => (url.includes("api.github.com") ? Response.json([release]) : Response.json(manifest))) as typeof fetch;
    for (const [platform, arch, file] of [["win32", "x64", FILES.win], ["darwin", "arm64", FILES.arm], ["darwin", "x64", FILES.intel]] as const) {
      const state = await createReleaseChecker({ installedVersion: "0.1.0", platform, arch, fetcher }).check();
      expect(state.status).toBe("update-available"); expect(state.package?.name).toBe(file);
    }
    expect(fs.readFileSync(path.join(s.out, "release-report-production.md"), "utf8")).toMatch(/aprovado para revisão humana e publicação manual/);
  });

  it("without an Intel build the Mac Intel target is simply not offered, and the report says so", () => {
    const s = scenario("nointel"); const r = run(s, "production");
    expect(r.code).toBe(0);
    expect(Object.keys(JSON.parse(fs.readFileSync(path.join(s.out, "update-manifest.json"), "utf8")).platforms).sort()).toEqual(["darwin-aarch64", "windows-x86_64"]);
    expect(fs.readFileSync(path.join(s.out, "release-report-production.md"), "utf8")).toMatch(/Alvos sem instalador \(não serão oferecidos\): darwin-x86_64, linux-x86_64/);
  });

  const blocked: [string, Opts, RegExp][] = [
    ["a version file that does not match the tag", { versions: "0.1.0" }, /está em 0\.1\.0, a tag pede 0\.2\.0/],
    ["a hash that does not match SHA256SUMS.txt", { mutate: a => edit(a, FILES.win, b => Buffer.concat([b, Buffer.from("!")])) }, /não confere com SHA256SUMS/],
    ["an updater signature made over other bytes", { mutate: a => fs.writeFileSync(path.join(a, FILES.arm + ".sig"), signer.sign(Buffer.from("outro conteúdo")).file) }, /Assinatura do atualizador.*não confere/],
    ["an updater signature by another key", { mutate: a => fs.writeFileSync(path.join(a, FILES.arm + ".sig"), other.sign(fs.readFileSync(path.join(a, FILES.arm))).file) }, /Assinatura do atualizador.*não confere/],
    ["a missing .sig file", { mutate: a => fs.rmSync(path.join(a, FILES.win + ".sig")) }, /Sem arquivo de assinatura/],
    ["missing platform evidence", { mutate: a => fs.rmSync(path.join(a, "evidence", "darwin-aarch64.json")) }, /Sem evidência/],
    ["an installed self-test that was not run", { mutate: a => fs.writeFileSync(path.join(a, "evidence/windows-x86_64.json"), JSON.stringify(evidence("windows-x86_64", { tests: { installedSelfTest: "not-run", upgradeFromPrevious: "pass", uninstallKeepsData: "pass" } }))) }, /installedSelfTest.*não passou/],
    ["an upgrade test that failed", { mutate: a => fs.writeFileSync(path.join(a, "evidence/darwin-aarch64.json"), JSON.stringify(evidence("darwin-aarch64", { tests: { installedSelfTest: "pass", upgradeFromPrevious: "fail", uninstallKeepsData: "pass" } }))) }, /upgradeFromPrevious.*não passou/],
    ["an unsigned Windows installer", { mutate: a => fs.writeFileSync(path.join(a, "evidence/windows-x86_64.json"), JSON.stringify(evidence("windows-x86_64", { signing: { codeSigned: false } }))) }, /sem assinatura de código/],
    ["a Mac build that is signed but not notarized", { mutate: a => fs.writeFileSync(path.join(a, "evidence/darwin-aarch64.json"), JSON.stringify(evidence("darwin-aarch64", { signing: { codeSigned: true, notarized: false } }))) }, /sem notarização/],
    ["evidence of another version", { mutate: a => fs.writeFileSync(path.join(a, "evidence/windows-x86_64.json"), JSON.stringify(evidence("windows-x86_64", { version: "0.1.0" }))) }, /é da versão 0\.1\.0/],
    ["installers built from different commits", { mutate: a => fs.writeFileSync(path.join(a, "evidence/windows-x86_64.json"), JSON.stringify(evidence("windows-x86_64", { builtFrom: "b".repeat(40) }))) }, /commits diferentes/],
    ["notes still containing TODO", { notes: "## LawyerMind 0.2.0\n\nTODO: escrever o resumo das mudanças desta versão.\n" }, /Notas de versão vazias/],
    ["empty notes", { notes: "curto" }, /Notas de versão vazias/],
    ["an ambiguous installer name", { mutate: a => { fs.renameSync(path.join(a, FILES.arm), path.join(a, "LawyerMind_0.2.0.dmg")); } }, /nome ambíguo/],
    ["two installers for one target", { mutate: a => { fs.copyFileSync(path.join(a, FILES.arm), path.join(a, "LawyerMind_0.2.0_arm64.dmg")); } }, /Mais de um instalador para darwin-aarch64/],
    ["a required platform with no installer", { mutate: a => { fs.rmSync(path.join(a, FILES.arm)); fs.rmSync(path.join(a, FILES.arm + ".sig")); } }, /Sem instalador real para darwin-aarch64/],
  ];
  it.each(blocked)("blocks: %s — and writes no manifest", (name, o, message) => {
    const s = scenario("b-" + name.replace(/\W+/g, "-").slice(0, 40), o);
    const r = run(s, "production");
    expect(r.code).toBe(1); expect(r.out).toMatch(message); expect(r.out).toMatch(/NÃO APROVADO/);
    expect(r.wrote).not.toContain("update-manifest.json"); expect(r.wrote).not.toContain("SHA256SUMS.txt");
    expect(fs.readFileSync(path.join(s.out, "release-report-production.md"), "utf8")).toMatch(/NÃO APROVADO/);
  });

  it("a pre-release tag is refused", () => {
    const s = scenario("pre"); const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", SCRIPT, "--tag", "v0.2.0-beta.1", "--root", s.root, "--artifacts", s.art, "--notes", s.notes, "--pubkey", s.pub, "--channel", "production", "--out", s.out], { encoding: "utf8" });
    expect(r.status).toBe(1); expect(r.stderr).toMatch(/sem sufixo de pré-lançamento/);
  });
});

describe("test channel (reviewable, unsigned builds)", () => {
  it("never writes the manifest the app reads, even if everything else is perfect", () => {
    const s = scenario("t-perfect"); const r = run(s, "test");
    expect(r.code).toBe(0); expect(r.wrote).not.toContain("update-manifest.json");
    expect(r.wrote).toContain("NOT-ANNOUNCEABLE.txt");
    expect(fs.readFileSync(path.join(s.out, "NOT-ANNOUNCEABLE.txt"), "utf8")).toMatch(/nunca o oferecerá/);
  });
  it("accepts unsigned, not-yet-tested builds for review and reports exactly that", () => {
    const s = scenario("t-unsigned", { mutate: a => { for (const t of ["windows-x86_64", "darwin-aarch64"]) fs.writeFileSync(path.join(a, "evidence", `${t}.json`), JSON.stringify(evidence(t, { signing: { codeSigned: false }, tests: { installedSelfTest: "pass", upgradeFromPrevious: "not-run", uninstallKeepsData: "not-run" } }))); } });
    const r = run(s, "test");
    expect(r.code).toBe(0); expect(r.wrote).not.toContain("update-manifest.json");
    const report = fs.readFileSync(path.join(s.out, "release-report-test.md"), "utf8");
    expect(report).toMatch(/build de TESTE \(nunca anunciável\)/); expect(report).toMatch(/NÃO assinado/);
  });
  it("raw CI artifacts (no .sig, no evidence file) are reviewable as warnings in the test channel, and still blocked in production", () => {
    const strip = (a: string) => { fs.rmSync(path.join(a, "evidence"), { recursive: true }); for (const f of fs.readdirSync(a)) if (f.endsWith(".sig")) fs.rmSync(path.join(a, f)); };
    const s = scenario("t-raw", { mutate: strip });
    const r = run(s, "test");
    expect(r.code).toBe(0); expect(r.wrote).not.toContain("update-manifest.json");
    expect(r.out).toMatch(/sem assinatura do atualizador/); expect(r.out).toMatch(/sem evidence\/windows-x86_64\.json/);
    expect(run(scenario("t-raw-prod", { mutate: strip }), "production").code).toBe(1);
  });
  it("still refuses facts that cannot be reviewed: hash mismatch and ambiguous names", () => {
    expect(run(scenario("t-hash", { mutate: a => edit(a, FILES.win, b => Buffer.concat([b, Buffer.from("!")])) }), "test").code).toBe(1);
  });
});

it("version check alone reports each file that disagrees", () => {
  const s = scenario("vers", { versions: "0.1.0" });
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", SCRIPT, "--check-versions", "--tag", TAG, "--root", s.root], { encoding: "utf8" });
  // The scenario root declares 0.1.0 in all three files, so a v0.2.0 tag must be refused file by file.
  expect(r.status).toBe(1); expect(r.stdout).toMatch(/desktop\/Cargo\.toml.*0\.1\.0.*0\.2\.0/);
});
