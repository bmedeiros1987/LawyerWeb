import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { editorAvailability, editorBinary, editorEnv, editorKindFor, openWithEditor } from "@/lib/desktop/editors";

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ed-")); dirs.push(d); return d; };
const exe = (n: string) => n + (process.platform === "win32" ? ".exe" : "");
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); delete process.env.MBLZ_EDITORS_DIR; });

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
  it("o ambiente do editor não herda segredos do aplicativo", () => {
    const env = editorEnv({ PATH: "/bin", HOME: "/h", DATABASE_URL: "postgres://x", MBLZ_UPDATER_PUBLIC_KEY: "k", SESSION_SECRET: "s", AUTH_TOKEN: "t" });
    expect(Object.keys(env).sort()).toEqual(["HOME", "LAWYERMIND_EDITOR", "PATH"]);
  });
  it("sem o editor na instalação, abrir devolve false (sem inventar)", () => {
    process.env.MBLZ_EDITORS_DIR = tmp();
    expect(openWithEditor("pdf", "/qualquer.pdf")).toBe(false);
  });
});
