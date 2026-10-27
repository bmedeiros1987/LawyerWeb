import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { editorAvailability, editorBinary, editorEnv, editorKindFor, openWithEditor } from "@/lib/desktop/editors";

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ed-")); dirs.push(d); return d; };
const exe = (n: string) => n + (process.platform === "win32" ? ".exe" : "");
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); delete process.env.MBLZ_EDITORS_DIR; delete process.env.MBLZ_DESKTOP_STATE_DIR; });

describe("editores embutidos", () => {
  it("escolhe o editor pela extensão e ignora o resto", () => {
    expect(editorKindFor("Contrato.PDF")).toBe("pdf");
    expect(editorKindFor("minuta.docx")).toBe("word");
    for (const n of ["a.doc", "a.txt", "a.pdf.exe", "a.docx.zip", "pdf"]) expect(editorKindFor(n)).toBeNull();
  });
  it("sem pasta de editores (ou relativa), nada fica disponível", () => {
    expect(editorAvailability(undefined)).toEqual({ pdf: false, word: false });
    expect(editorBinary("pdf", "relativa/editors")).toBeNull();
    expect(editorBinary("pdf", path.join(tmp(), "nao-existe"))).toBeNull();
  });
  it("só conta arquivos regulares com o nome esperado", () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, exe("lawyermind-pdf")));          // pasta com o nome do binário não vale
    fs.writeFileSync(path.join(d, exe("lawyermind-word")), "x");
    expect(editorAvailability(d)).toEqual({ pdf: false, word: true });
  });
  it("o ambiente do editor não herda segredos do aplicativo, e reconhece as variáveis do Windows em qualquer caixa", () => {
    const env = editorEnv({ PATH: "/bin", HOME: "/h", SystemRoot: "C:\\Windows", ProgramData: "C:\\ProgramData", DATABASE_URL: "postgres://x", MBLZ_UPDATER_PUBLIC_KEY: "k", AUTH_SECRET: "s", AUTH_TOKEN: "t" });
    expect(Object.keys(env).sort()).toEqual(["HOME", "LAWYERMIND_EDITOR", "PATH", "ProgramData", "SystemRoot"]);
  });
  it("sem o editor na instalação, abrir diz 'não instalado' (sem inventar)", async () => {
    process.env.MBLZ_EDITORS_DIR = tmp();
    expect(await openWithEditor("pdf", "/qualquer.pdf")).toMatchObject({ ok: false, reason: "not-installed" });
  });
});

// Executables written as shell scripts: Linux/macOS only (Windows is covered by the CI run on the real installer).
describe.skipIf(process.platform === "win32")("abrir o editor: só diz 'aberto' se ele realmente subiu", () => {
  const make = (body: string) => { const d = tmp(); const f = path.join(d, "lawyermind-pdf"); fs.writeFileSync(f, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); process.env.MBLZ_EDITORS_DIR = d; process.env.MBLZ_DESKTOP_STATE_DIR = path.join(d, "estado"); return d; };
  it("editor que fecha na hora é reportado com o código e o log guarda a saída", async () => {
    make('echo "falha simulada de GPU" >&2\nexit 3');
    const r = await openWithEditor("pdf", "/tmp/contrato.pdf", 3000);
    expect(r).toMatchObject({ ok: false, reason: "failed", message: expect.stringContaining("código 3") });
    const log = fs.readFileSync((r as { log: string }).log, "utf8");
    expect(log).toContain("contrato.pdf");
    expect(log).toContain("falha simulada de GPU");
  });
  it("editor que continua rodando é 'ok' e recebe só o caminho do arquivo", async () => {
    const d = make('echo "$# $1" > "$(dirname "$0")/args.txt"\nexec sleep 30');
    const r = await openWithEditor("pdf", "/tmp/contrato.pdf", 600);
    expect(r).toMatchObject({ ok: true });
    if (r.ok && r.pid) process.kill(r.pid, "SIGKILL");
    expect(fs.readFileSync(path.join(d, "args.txt"), "utf8").trim()).toBe("1 /tmp/contrato.pdf");
  });
  it("binário que não executa vira falha clara, não sucesso", async () => {
    const d = tmp(); fs.writeFileSync(path.join(d, "lawyermind-pdf"), "não é executável", { mode: 0o644 }); process.env.MBLZ_EDITORS_DIR = d;
    const r = await openWithEditor("pdf", "/tmp/x.pdf", 1500);
    expect(r).toMatchObject({ ok: false, reason: "failed" });
  });
});
