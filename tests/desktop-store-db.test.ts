// Negative tests for the desktop working-copy store against a real PostgreSQL
// (a dedicated, throw-away database: restore replaces every table).
//   a) read-only permission never opens the editable copy
//   b) a restore that fails before commit leaves data AND the documents folder as they were
//   c) symbolic links, junctions and hard links cannot make a path leave the authorized folder
//   d) backup holds the store lock and refuses a copy that changes while it is read
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const RUN = process.env.RUN_DB_TESTS === "1";
const sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const ls = (d: string) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).map(String).sort() : []);
// Windows needs no privilege for junctions; elsewhere "junction" is ignored and a symlink is made.
const linkDir = (target: string, at: string) => fs.symlinkSync(target, at, "junction");

describe.skipIf(!RUN)("desktop working-copy store (negative cases)", () => {
  const dbName = `lm_desktop_test_${crypto.randomBytes(4).toString("hex")}`;
  const adminUrl = process.env.DATABASE_URL!;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-store-"));
  const state = path.join(tmp, "estado"), work = path.join(tmp, "trabalho"), outside = path.join(tmp, "fora");
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let m: any = {};
  let owner: any, viewer: any, version: { versionId: string; storageKey: string; documentId: string };
  let original: string;

  const copyPath = () => path.join(state, "documentos", ...version.storageKey.split("/"));
  const rejects = async (p: Promise<unknown>, code: string | number) => {
    const e: any = await p.then(() => null, x => x);
    expect(e, `deveria falhar com ${code}`).toBeTruthy();
    if (typeof code === "number") expect(e.status).toBe(code); else expect(e.code).toBe(code);
    return e;
  };

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect(); await admin.query(`create database ${dbName}`); await admin.end();
    const url = new URL(adminUrl); url.pathname = "/" + dbName;
    Object.assign(process.env, {
      DATABASE_URL: url.toString(), MBLZ_DESKTOP: "1", MBLZ_DESKTOP_STATE_DIR: state, MBLZ_DESKTOP_NO_LAUNCH: "1",
      MBLZ_DESKTOP_MIGRATIONS_DIR: path.resolve("prisma/migrations"),
    });
    for (const d of [state, work, outside]) fs.mkdirSync(d, { recursive: true });
    m = {
      ...(await import("@/lib/desktop/migrate")), ...(await import("@/lib/desktop/documents")), ...(await import("@/lib/desktop/backup")),
      ...(await import("@/lib/desktop/open")), ...(await import("@/lib/desktop/settings")), ...(await import("@/lib/desktop/db")),
      prisma: (await import("@/lib/prisma")).prisma,
    };
    await m.runDesktopMigrations();
    const p = m.prisma;
    const ws = await p.workspace.create({ data: { name: "Escritório de teste", slug: `t-${dbName}` } });
    const full = await p.workspaceRole.create({ data: { workspaceId: ws.id, name: "Proprietário", permissions: { allow: ["*"] } } });
    const readOnly = await p.workspaceRole.create({ data: { workspaceId: ws.id, name: "Somente leitura", permissions: { allow: ["documents.view", "matters.view", "clients.view"] } } });
    const u1 = await p.user.create({ data: { name: "Titular" } }), u2 = await p.user.create({ data: { name: "Leitor" } });
    await p.workspaceMember.create({ data: { workspaceId: ws.id, userId: u1.id, roleId: full.id } });
    await p.workspaceMember.create({ data: { workspaceId: ws.id, userId: u2.id, roleId: readOnly.id } });
    const member = (userId: string) => p.workspaceMember.findFirstOrThrow({ where: { userId }, include: { role: true } });
    owner = { userId: u1.id, member: await member(u1.id) };
    viewer = { userId: u2.id, member: await member(u2.id) };
    const drive = path.join(work, "Google Drive", "Meu Drive"); fs.mkdirSync(drive, { recursive: true });
    original = path.join(drive, "Contrato.docx"); fs.writeFileSync(original, "contrato sintético v1\n"); fs.chmodSync(original, 0o444);
    version = await m.importDocument({ userId: u1.id, workspaceId: ws.id, sourcePath: original, name: "Contrato" });
  }, 120_000);

  afterAll(async () => {
    await m.prisma?.$disconnect(); await m.pool?.().end();
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect(); await admin.query(`drop database if exists ${dbName} with (force)`); await admin.end();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // ---- a) permission ---------------------------------------------------------
  it("a) with documents.view only, the editable working copy is never opened nor revealed", async () => {
    await rejects(m.openVersion({ ...viewer, versionId: version.versionId, mode: "edit" }), 403);
    await rejects(m.openVersion({ ...viewer, versionId: version.versionId, mode: "read", reveal: true }), 403);
    const r = await m.openVersion({ ...viewer, versionId: version.versionId, mode: "read" });
    expect(r.mode).toBe("read");
    expect(path.resolve(r.path)).not.toBe(path.resolve(copyPath()));
    expect(r.path.startsWith(path.join(state, "leitura") + path.sep)).toBe(true);
    expect(sha(r.path)).toBe(sha(copyPath()));
    expect(fs.statSync(r.path).mode & 0o222).toBe(0); // read-only file
    const e = await m.openVersion({ ...owner, versionId: version.versionId, mode: "edit" });
    expect(fs.realpathSync(e.path)).toBe(fs.realpathSync(copyPath()));
  });

  // ---- c) links ----------------------------------------------------------------
  it("c) a working copy replaced by a symbolic link to an outside file is refused everywhere", async () => {
    const secret = path.join(outside, "segredo.txt"); fs.writeFileSync(secret, "fora da pasta autorizada");
    const saved = copyPath() + ".orig"; fs.renameSync(copyPath(), saved);
    fs.symlinkSync(secret, copyPath());
    try {
      await rejects(m.openVersion({ ...owner, versionId: version.versionId, mode: "edit" }), "link");
      await rejects(m.openVersion({ ...viewer, versionId: version.versionId, mode: "read" }), "link");
      const dest = path.join(work, "exportado.docx");
      await rejects(m.exportVersion({ versionId: version.versionId, workspaceId: owner.member.workspaceId, destPath: dest }), "link");
      expect(fs.existsSync(dest)).toBe(false);
      const bk = path.join(work, "com-link.lawyermind-backup");
      await rejects(m.createBackup({ dest: bk, includeDocuments: true }), "link");
      expect(ls(work).some(f => f.includes("com-link"))).toBe(false);
      await rejects(m.setRoot(path.join(state, "documentos"), true), "link");
    } finally { fs.rmSync(copyPath()); fs.renameSync(saved, copyPath()); }
  });

  it("c) a document folder replaced by a junction/symlink to an outside folder is refused", async () => {
    const docDir = path.dirname(copyPath());
    const moved = path.join(outside, "pasta-movida"); fs.renameSync(docDir, moved);
    linkDir(moved, docDir);
    try {
      await rejects(m.openVersion({ ...owner, versionId: version.versionId, mode: "edit" }), "link");
      await rejects(m.createBackup({ dest: path.join(work, "junction"), includeDocuments: true }), "link");
    } finally { fs.rmSync(docDir); fs.renameSync(moved, docDir); }
  });

  it("c) a hard link to a file outside is refused (edits would reach that file)", async () => {
    const other = path.join(outside, "vinculado.docx"); fs.writeFileSync(other, "arquivo de outra pasta");
    const saved = copyPath() + ".orig"; fs.renameSync(copyPath(), saved);
    fs.linkSync(other, copyPath());
    try {
      await rejects(m.openVersion({ ...owner, versionId: version.versionId, mode: "edit" }), "link");
      expect(fs.readFileSync(other, "utf8")).toBe("arquivo de outra pasta");
    } finally { fs.rmSync(copyPath()); fs.renameSync(saved, copyPath()); }
  });

  it("c) import refuses a workspace folder that is a link, and writes nothing outside", async () => {
    const wsDir = path.join(state, "documentos", "ws", owner.member.workspaceId);
    const moved = path.join(outside, "ws-movido"); fs.renameSync(wsDir, moved);
    const before = ls(moved);
    linkDir(moved, wsDir);
    try {
      await rejects(m.importDocument({ userId: owner.userId, workspaceId: owner.member.workspaceId, sourcePath: original }), "link");
      expect(ls(moved)).toEqual(before);
    } finally { fs.rmSync(wsDir); fs.renameSync(moved, wsDir); }
  });

  it("c) export to a folder that links into the working copies is refused", async () => {
    const alias = path.join(work, "atalho-para-documentos"); linkDir(path.join(state, "documentos"), alias);
    const before = ls(path.join(state, "documentos"));
    await rejects(m.exportVersion({ versionId: version.versionId, workspaceId: owner.member.workspaceId, destPath: path.join(alias, "x.docx") }), 400);
    expect(ls(path.join(state, "documentos"))).toEqual(before);
  });

  it("c) restore refuses a target with a link inside and writes nothing outside", async () => {
    const bk = await m.createBackup({ dest: path.join(work, "para-links"), includeDocuments: true });
    const target = path.join(work, "alvo-com-link"); fs.mkdirSync(target);
    const trap = path.join(outside, "armadilha"); fs.mkdirSync(trap);
    linkDir(trap, path.join(target, "ws"));
    await rejects(m.restoreBackup({ file: bk.path, documentsTarget: target }), "link");
    expect(ls(trap)).toEqual([]);
    expect(await m.documentsRoot()).toBe(fs.realpathSync(path.join(state, "documentos")));
  });

  // ---- b) restore ordering -------------------------------------------------------
  it("b) a restore that fails before commit keeps the data and the documents folder", async () => {
    const bk = await m.createBackup({ dest: path.join(work, "antes-de-cliente"), includeDocuments: true });
    const later = await m.prisma.client.create({ data: { workspaceId: owner.member.workspaceId, name: "Cliente posterior" } });
    const rootBefore = await m.documentsRoot();
    const target = path.join(work, "restaurado-falho");
    await expect(m.restoreBackup({ file: bk.path, documentsTarget: target, beforeCommit: async () => { throw new Error("queda simulada antes do commit"); } }))
      .rejects.toThrow("queda simulada");
    expect(await m.documentsRoot()).toBe(rootBefore);
    expect(await m.prisma.client.findUnique({ where: { id: later.id } })).not.toBeNull();
    expect(fs.existsSync(path.join(state, "settings.json"))).toBe(false);

    const ok = await m.restoreBackup({ file: bk.path, documentsTarget: path.join(work, "restaurado") });
    expect(await m.documentsRoot()).toBe(ok.documents_root);
    expect(ok.documents_root).toBe(fs.realpathSync(path.join(work, "restaurado")));
    expect(await m.prisma.client.findUnique({ where: { id: later.id } })).toBeNull();
    // back to the original folder for the next tests
    await m.setRoot(path.join(state, "documentos"), false);
  });

  // ---- d) backup consistency -----------------------------------------------------
  it("d) a working copy changed while the backup reads it aborts the backup (no file left)", async () => {
    const dest = path.join(work, "durante-edicao");
    await rejects(m.createBackup({ dest, includeDocuments: true, onFileChunk: () => fs.appendFileSync(copyPath(), "salvamento automático durante o backup\n") }), "changed");
    expect(ls(work).filter(f => f.includes("durante-edicao"))).toEqual([]);
    const ok = await m.createBackup({ dest, includeDocuments: true });
    const manifest = await m.verifyBackup(ok.path);
    expect(manifest.entries[`files/${version.storageKey}`]).toBe(sha(copyPath()));
  });

  it("d) backup and restore wait for imports (store lock) and give up with 'busy'", async () => {
    const c = await m.pool().connect();
    try {
      await c.query("select pg_advisory_lock_shared(7312)"); // an import in progress
      await rejects(m.createBackup({ dest: path.join(work, "ocupado"), includeDocuments: true, lockTimeoutMs: 600 }), "busy");
      await rejects(m.restoreBackup({ file: path.join(work, "antes-de-cliente.lawyermind-backup"), documentsTarget: path.join(work, "r2"), lockTimeoutMs: 600 }), "busy");
      expect(fs.existsSync(path.join(work, "ocupado.lawyermind-backup"))).toBe(false);
      expect(fs.existsSync(path.join(work, "r2"))).toBe(false);
    } finally { await c.query("select pg_advisory_unlock_shared(7312)"); c.release(); }
  });
});
