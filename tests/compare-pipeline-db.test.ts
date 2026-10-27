// The REAL pipeline, no doubles: import two real files (a DOCX and a PDF), extract their text
// through the same code the app uses, and compare. Throw-away PostgreSQL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import yazl from "yazl";
import { PDFDocument, StandardFonts } from "pdf-lib";

const RUN = process.env.RUN_DB_TESTS === "1";

function docx(file: string, paragraphs: string[]) {
  return new Promise<void>((resolve, reject) => {
    const z = new yazl.ZipFile();
    z.addBuffer(Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'), "[Content_Types].xml");
    z.addBuffer(Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'), "_rels/.rels");
    const body = paragraphs.map(p => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
    z.addBuffer(Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`), "word/document.xml");
    z.end();
    z.outputStream.pipe(fs.createWriteStream(file)).on("close", resolve).on("error", reject);
  });
}

async function pdf(file: string, lines: string[]) {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([595, 842]); lines.forEach((l, i) => p.drawText(l, { x: 50, y: 780 - i * 24, size: 12, font: f }));
  fs.writeFileSync(file, await d.save());
}

describe.skipIf(!RUN)("comparação: arquivo real → texto → observações", () => {
  const dbName = `lm_cmp_test_${crypto.randomBytes(4).toString("hex")}`;
  const adminUrl = process.env.DATABASE_URL!;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cmp-"));
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let m: any = {}; let owner: any;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect(); await admin.query(`create database ${dbName}`); await admin.end();
    const url = new URL(adminUrl); url.pathname = "/" + dbName;
    Object.assign(process.env, { DATABASE_URL: url.toString(), MBLZ_DESKTOP: "1", MBLZ_DESKTOP_STATE_DIR: path.join(tmp, "estado"), MBLZ_DESKTOP_NO_LAUNCH: "1", MBLZ_DESKTOP_MIGRATIONS_DIR: path.resolve("prisma/migrations") });
    fs.mkdirSync(path.join(tmp, "estado"), { recursive: true });
    m = { ...(await import("@/lib/desktop/migrate")), ...(await import("@/lib/desktop/documents")), ...(await import("@/lib/desktop/db")), ...(await import("@/lib/ai/document-text")), ...(await import("@/lib/compare/compare")), prisma: (await import("@/lib/prisma")).prisma };
    await m.runDesktopMigrations();
    const p = m.prisma;
    const ws = await p.workspace.create({ data: { name: "Escritório", slug: `t-${dbName}` } });
    const role = await p.workspaceRole.create({ data: { workspaceId: ws.id, name: "Proprietário", permissions: { allow: ["*"] } } });
    const u = await p.user.create({ data: { name: "Titular" } });
    await p.workspaceMember.create({ data: { workspaceId: ws.id, userId: u.id, roleId: role.id } });
    owner = { userId: u.id, member: await p.workspaceMember.findFirstOrThrow({ where: { userId: u.id }, include: { role: true } }) };
  }, 120_000);

  afterAll(async () => {
    await m.prisma?.$disconnect(); await m.pool?.().end();
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect(); await admin.query(`drop database if exists ${dbName} with (force)`); await admin.end();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const importFile = (file: string, documentId?: string) => m.importDocument({ userId: owner.userId, workspaceId: owner.member.workspaceId, sourcePath: file, name: "Contrato de teste", documentId });

  it("DOCX v1 × v2 (mesmo documento): detecta valor, prazo e cláusula nova, citando o trecho literal", async () => {
    const f1 = path.join(tmp, "contrato-v1.docx"), f2 = path.join(tmp, "contrato-v2.docx");
    await docx(f1, ["CLÁUSULA 1. O valor do contrato é de R$ 10.000,00.", "CLÁUSULA 2. O prazo para pagamento é de 30 dias.", "CLÁUSULA 3. Foro da comarca de São Paulo."]);
    await docx(f2, ["CLÁUSULA 1. O valor do contrato é de R$ 12.500,00.", "CLÁUSULA 2. O prazo para pagamento é de 15 dias.", "CLÁUSULA 3. Foro da comarca de São Paulo.", "CLÁUSULA 4. Multa de 2% ao mês."]);
    const v1 = await importFile(f1), v2 = await importFile(f2, v1.documentId);
    const left = await m.authorizedVersionText(owner.userId, owner.member, v1.versionId);
    const right = await m.authorizedVersionText(owner.userId, owner.member, v2.versionId);
    expect(left.text).toContain("R$ 10.000,00");
    const r = m.compareTexts(left.text, right.text);
    expect(r.status).toBe("ok");
    const titles = r.observations.map((o: any) => `${o.kind}: ${o.title}`).join("\n");
    expect(r.observations.some((o: any) => o.kind.startsWith("value") || o.kind === "changed")).toBe(true);
    expect(titles.length).toBeGreaterThan(0);
    // Toda observação traz o trecho literal e o que conferir.
    for (const o of r.observations) {
      expect(o.check).toBeTruthy();
      for (const s of o.sources) expect((s.side === "left" ? left.text : right.text)).toContain(s.quote.replace(/…$/, "").slice(0, 20));
    }
    const all = JSON.stringify(r.observations);
    expect(all).toContain("12.500,00");
    expect(all).toMatch(/Multa de 2%/);
  });

  it("PDF × DOCX: a leitura de PDF também alimenta a comparação (ou diz honestamente que não leu)", async () => {
    const a = path.join(tmp, "a.pdf"), b = path.join(tmp, "b.docx");
    await pdf(a, ["CLAUSULA 1. Valor de R$ 1.000,00 ao mes."]);
    await docx(b, ["CLAUSULA 1. Valor de R$ 2.000,00 ao mes."]);
    const va = await importFile(a), vb = await importFile(b);
    const left = await m.authorizedVersionText(owner.userId, owner.member, va.versionId);
    const right = await m.authorizedVersionText(owner.userId, owner.member, vb.versionId);
    const r = m.compareTexts(left.text, right.text);
    expect(r.status).toBe("ok");
    expect(JSON.stringify(r.observations)).toMatch(/2\.000,00/);
  });

  it("arquivo sem texto legível não vira comparação inventada", async () => {
    const f = path.join(tmp, "vazio.pdf"); const d = await PDFDocument.create(); d.addPage([200, 200]); fs.writeFileSync(f, await d.save());
    const v = await importFile(f);
    await expect(m.authorizedVersionText(owner.userId, owner.member, v.versionId)).rejects.toMatchObject({ status: 422 });
  });
});
