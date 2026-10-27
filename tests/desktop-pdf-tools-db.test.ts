// PDF tools against a real PostgreSQL (throw-away database): results are new versions/documents,
// the source version and the original stay byte-identical, permissions are enforced.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { PDFDocument } from "pdf-lib";

const RUN = process.env.RUN_DB_TESTS === "1";
const sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

describe.skipIf(!RUN)("desktop PDF tools", () => {
  const dbName = `lm_pdftools_test_${crypto.randomBytes(4).toString("hex")}`;
  const adminUrl = process.env.DATABASE_URL!;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-pdft-"));
  const state = path.join(tmp, "estado"), work = path.join(tmp, "trabalho");
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let m: any = {}; let owner: any, viewer: any, v1: any, v2: any, original: string, original2: string, txt: any;

  const pdf = async (pages: number) => { const d = await PDFDocument.create(); for (let i = 0; i < pages; i++) d.addPage([200 + i, 100]); return Buffer.from(await d.save()); };
  const copyOf = (key: string) => path.join(state, "documentos", ...key.split("/"));
  const pagesOf = async (key: string) => (await PDFDocument.load(fs.readFileSync(copyOf(key)))).getPageCount();
  const fail = async (p: Promise<unknown>, status: number) => { const e: any = await p.then(() => null, x => x); expect(e?.status).toBe(status); return e; };

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect(); await admin.query(`create database ${dbName}`); await admin.end();
    const url = new URL(adminUrl); url.pathname = "/" + dbName;
    Object.assign(process.env, { DATABASE_URL: url.toString(), MBLZ_DESKTOP: "1", MBLZ_DESKTOP_STATE_DIR: state, MBLZ_DESKTOP_NO_LAUNCH: "1", MBLZ_DESKTOP_MIGRATIONS_DIR: path.resolve("prisma/migrations") });
    fs.mkdirSync(state, { recursive: true }); fs.mkdirSync(work, { recursive: true });
    m = { ...(await import("@/lib/desktop/migrate")), ...(await import("@/lib/desktop/documents")), ...(await import("@/lib/desktop/pdf-tools")), ...(await import("@/lib/desktop/db")), prisma: (await import("@/lib/prisma")).prisma };
    await m.runDesktopMigrations();
    const p = m.prisma;
    const ws = await p.workspace.create({ data: { name: "Escritório de teste", slug: `t-${dbName}` } });
    const full = await p.workspaceRole.create({ data: { workspaceId: ws.id, name: "Proprietário", permissions: { allow: ["*"] } } });
    const ro = await p.workspaceRole.create({ data: { workspaceId: ws.id, name: "Leitura", permissions: { allow: ["documents.view", "matters.view", "clients.view"] } } });
    const u1 = await p.user.create({ data: { name: "Titular" } }), u2 = await p.user.create({ data: { name: "Leitor" } });
    await p.workspaceMember.create({ data: { workspaceId: ws.id, userId: u1.id, roleId: full.id } });
    await p.workspaceMember.create({ data: { workspaceId: ws.id, userId: u2.id, roleId: ro.id } });
    const member = (userId: string) => p.workspaceMember.findFirstOrThrow({ where: { userId }, include: { role: true } });
    owner = { userId: u1.id, member: await member(u1.id) }; viewer = { userId: u2.id, member: await member(u2.id) };
    original = path.join(work, "Contrato.pdf"); fs.writeFileSync(original, await pdf(5));
    original2 = path.join(work, "Anexo.pdf"); fs.writeFileSync(original2, await pdf(2));
    v1 = await m.importDocument({ userId: u1.id, workspaceId: ws.id, sourcePath: original, name: "Contrato" });
    v2 = await m.importDocument({ userId: u1.id, workspaceId: ws.id, sourcePath: original2, name: "Anexo" });
    const t = path.join(work, "nota.txt"); fs.writeFileSync(t, "texto"); txt = await m.importDocument({ userId: u1.id, workspaceId: ws.id, sourcePath: t, name: "Nota" });
  }, 120_000);

  afterAll(async () => {
    await m.prisma?.$disconnect(); await m.pool?.().end();
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect(); await admin.query(`drop database if exists ${dbName} with (force)`); await admin.end();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("girar/remover/extrair criam NOVA versão do mesmo documento e não alteram a de origem nem o original", async () => {
    const before = [sha(original), sha(copyOf(v1.storageKey))];
    const r = await m.runPdfTool({ ...owner, request: { tool: "delete", versionId: v1.versionId, pages: "2-3" } });
    expect(r.created).toHaveLength(1);
    expect(r.created[0].documentId).toBe(v1.documentId);
    expect(r.created[0].version).toBe(2);
    const stored = await m.prisma.documentVersion.findUniqueOrThrow({ where: { id: r.created[0].versionId } });
    expect(await pagesOf(stored.storageKey)).toBe(3);
    expect(JSON.parse(stored.notes).derived.fromVersionIds).toEqual([v1.versionId]);
    expect([sha(original), sha(copyOf(v1.storageKey))]).toEqual(before);
    const log = await m.prisma.activityLog.findFirst({ where: { entityId: v1.documentId, type: "DOCUMENT_DERIVED" } });
    expect(log).toBeTruthy();
    const rot = await m.runPdfTool({ ...owner, request: { tool: "rotate", versionId: r.created[0].versionId, pages: "1", angle: 90 } });
    expect(rot.created[0].version).toBe(3);
  });

  it("dividir e juntar criam documentos novos", async () => {
    const s = await m.runPdfTool({ ...owner, request: { tool: "split", versionId: v1.versionId, ranges: ["1-2", "3-"] } });
    expect(s.created.map((c: any) => c.documentId)).not.toContain(v1.documentId);
    expect(new Set(s.created.map((c: any) => c.documentId)).size).toBe(2);
    const j = await m.runPdfTool({ ...owner, request: { tool: "merge", versionIds: [v1.versionId, v2.versionId], name: "Contrato com anexo" } });
    const stored = await m.prisma.documentVersion.findUniqueOrThrow({ where: { id: j.created[0].versionId }, include: { document: true } });
    expect(stored.document.name).toBe("Contrato com anexo");
    expect(await pagesOf(stored.storageKey)).toBe(7);
  });

  it("exige documents.edit e recusa o que não é PDF, intervalo inválido e versões repetidas", async () => {
    await fail(m.runPdfTool({ ...viewer, request: { tool: "extract", versionId: v1.versionId, pages: "1" } }), 403);
    await fail(m.runPdfTool({ ...owner, request: { tool: "extract", versionId: txt.versionId, pages: "1" } }), 400);
    await fail(m.runPdfTool({ ...owner, request: { tool: "extract", versionId: v1.versionId, pages: "99" } }), 422);
    await fail(m.runPdfTool({ ...owner, request: { tool: "merge", versionIds: [v1.versionId, v1.versionId] } }), 400);
  });

  it("a pasta temporária de derivados não fica para trás", async () => {
    const d = path.join(state, "derivados");
    expect(fs.existsSync(d) ? fs.readdirSync(d) : []).toEqual([]);
  });

  it("importar arquivo da pasta de dados continua proibido (derived não é brecha)", async () => {
    const inside = path.join(state, "qualquer.pdf"); fs.writeFileSync(inside, await pdf(1));
    await fail(m.importDocument({ userId: owner.userId, workspaceId: owner.member.workspaceId, sourcePath: inside }), 400);
    const derivDir = path.join(state, "derivados"); fs.mkdirSync(derivDir, { recursive: true });
    const sneaky = path.join(derivDir, "x.pdf"); fs.writeFileSync(sneaky, await pdf(1));
    // sem `derived`, a pasta de derivados também é proibida; com `derived` fora dela, idem
    await fail(m.importDocument({ userId: owner.userId, workspaceId: owner.member.workspaceId, sourcePath: sneaky }), 400);
    await fail(m.importDocument({ userId: owner.userId, workspaceId: owner.member.workspaceId, sourcePath: original, derived: { operation: "x", fromVersionIds: [] } }), 400);
  });
});
