import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { syncMarker } from "@/lib/desktop/sync";
import { resolveStorageKey, safeName } from "@/lib/desktop/paths";
import { DESTRUCTIVE } from "@/lib/desktop/migrate";

describe("desktop: pastas sincronizadas", () => {
  it.each([
    "/Users/a/Library/CloudStorage/GoogleDrive-a@b.com/Meu Drive/x",
    "C:/Users/a/OneDrive - Escritório/LawyerMind",
    "/home/a/Dropbox/db",
    "G:/Meu Drive/db",
    "G:/Drives compartilhados/Equipe",
    "/Users/a/Library/Mobile Documents/com~apple~CloudDocs/x",
    "/Users/a/iCloud Drive/x",
  ])("detecta %s", p => expect(syncMarker(p)).not.toBeNull());

  it.each([
    "/home/a/.local/share/br.mblz.lawyermind/pgdata",
    "C:/Users/a/AppData/Local/br.mblz.lawyermind/documentos",
    "/Users/a/Library/Application Support/br.mblz.lawyermind",
  ])("não acusa %s", p => expect(syncMarker(p)).toBeNull());
});

describe("desktop: caminhos de cópias de trabalho", () => {
  it("rejeita escapes", () => {
    for (const k of ["../x", "/etc/passwd", "C:/x", "a\\b", "a//b", "a/./b", ""]) expect(() => resolveStorageKey("/docs", k)).toThrow();
    expect(resolveStorageKey("/docs", "ws/1/2/v1-a.pdf")).toBe(path.join("/docs", "ws", "1", "2", "v1-a.pdf"));
  });
  it("gera nomes válidos em Windows/macOS/Linux", () => {
    expect(safeName("Petição: inicial?.docx")).toBe("Petição_ inicial_.docx");
    expect(safeName("CON.txt")).toBe("_CON.txt");
    expect(safeName("  ..  ")).toBe("documento");
    expect(safeName("a".repeat(200) + ".pdf").length).toBeLessThanOrEqual(80);
  });
});

describe("desktop: migrações não destrutivas", () => {
  it("as migrações atuais não têm operações destrutivas", () => {
    const dir = path.join(process.cwd(), "prisma", "migrations");
    for (const m of fs.readdirSync(dir).filter(d => fs.existsSync(path.join(dir, d, "migration.sql")))) {
      expect(DESTRUCTIVE.test(fs.readFileSync(path.join(dir, m, "migration.sql"), "utf8")), m).toBe(false);
    }
  });
  it.each(["DROP TABLE \"Client\"", "ALTER TABLE x DROP COLUMN y", "TRUNCATE x", "DELETE FROM x", "ALTER TABLE x RENAME TO y", "ALTER TABLE x RENAME COLUMN a TO b"])("bloqueia %s", sql => expect(DESTRUCTIVE.test(sql)).toBe(true));
  it("permite ON DELETE CASCADE e CREATE", () => expect(DESTRUCTIVE.test('CREATE TABLE a (b text REFERENCES c ON DELETE CASCADE)')).toBe(false));
});
