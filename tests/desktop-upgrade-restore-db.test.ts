// Real migration/backup/restore on a dedicated throw-away database.
// N+1 SQL is a synthetic fixture, not a released installer or OS reboot claim.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { desktopTestEnv, type DesktopTestEnv } from "./helpers/desktop-db";

const digest = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
describe.skipIf(process.env.RUN_DB_TESTS !== "1")("desktop synthetic N to N+1 and restore", () => {
  const adminUrl = process.env.DATABASE_URL!;
  const cached = globalThis as unknown as { prisma?: unknown; desktopPool?: unknown };
  let env: DesktopTestEnv;
  let migrate: typeof import("@/lib/desktop/migrate");
  let backup: typeof import("@/lib/desktop/backup");
  let docs: typeof import("@/lib/desktop/documents");
  let prisma: typeof import("@/lib/prisma")["prisma"];
  let clientId: string, workspaceId: string, original: string, originalSha: string;
  let version: Awaited<ReturnType<typeof import("@/lib/desktop/documents")["importDocument"]>>;
  let migrationDir: string;
  const upgradeName = "20990101000000_synthetic_upgrade";
  beforeEach(async () => {
    // Each case gets its own database, filesystem and fresh DB module instances.
    process.env.DATABASE_URL = adminUrl;
    delete cached.prisma; delete cached.desktopPool;
    vi.resetModules();
    env = await desktopTestEnv("upgrade");
    migrate = await import("@/lib/desktop/migrate"); backup = await import("@/lib/desktop/backup");
    docs = await import("@/lib/desktop/documents");
    prisma = (await import("@/lib/prisma")).prisma;
    const user = await prisma.user.create({ data: { name: "Titular sintético" } });
    const ws = await prisma.workspace.create({ data: { name: "QA sintética", slug: env.dbName } });
    workspaceId = ws.id;
    clientId = (await prisma.client.create({ data: { workspaceId, name: "Cliente preservado" } })).id;
    const drive = path.join(env.work, "Google Drive"); fs.mkdirSync(drive);
    original = path.join(drive, "Contrato.txt"); fs.writeFileSync(original, "Original sintético somente leitura\n");
    originalSha = digest(original); fs.chmodSync(original, 0o444);
    version = await docs.importDocument({ userId: user.id, workspaceId, sourcePath: original, name: "Contrato sintético" });
    migrationDir = path.join(env.work, "migrations");
    fs.cpSync(path.resolve("prisma/migrations"), migrationDir, { recursive: true });
    process.env.MBLZ_DESKTOP_MIGRATIONS_DIR = migrationDir;
  }, 120_000);
  afterEach(async () => {
    try { if (env) await env.cleanup(); }
    finally { process.env.DATABASE_URL = adminUrl; delete cached.prisma; delete cached.desktopPool; }
  });

  function addUpgrade() {
    const dir = path.join(migrationDir, upgradeName); fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "migration.sql"), "CREATE TABLE public.synthetic_upgrade_receipt (id text PRIMARY KEY);\n");
  }

  it("N+1 applies new SQL, takes a safety backup, preserves data/files and is idempotent", async () => {
    expect(await prisma.$queryRaw`SELECT to_regclass('public.synthetic_upgrade_receipt')::text AS receipt`).toEqual([{ receipt: null }]);
    addUpgrade();
    const r = await migrate.runDesktopMigrations();
    expect(r.applied).toEqual([upgradeName]);
    expect(await prisma.$queryRaw`SELECT to_regclass('public.synthetic_upgrade_receipt')::text AS receipt`).toEqual([{ receipt: "synthetic_upgrade_receipt" }]);
    expect(r.preMigrationBackup).toBeTruthy();
    const safety = await backup.verifyBackup(r.preMigrationBackup!);
    expect(safety.includes_documents).toBe(false);
    expect(safety.counts["public.Client"]).toBe(1);
    expect(await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).toMatchObject({ name: "Cliente preservado" });
    const copy = await docs.workingCopyPath(version.versionId, workspaceId);
    expect(digest(copy.file)).toBe(originalSha);
    expect(digest(original)).toBe(originalSha);
    expect((await migrate.runDesktopMigrations()).applied).toEqual([]);
  }, 30_000);

  it("restores data and documents into an empty target without touching the original", async () => {
    const saved = await backup.createBackup({ dest: path.join(env.work, "com-documentos"), includeDocuments: true });
    await prisma.client.update({ where: { id: clientId }, data: { name: "Depois do backup" } });
    const copy = await docs.workingCopyPath(version.versionId, workspaceId); fs.writeFileSync(copy.file, "Cópia editada depois\n");
    const target = path.join(env.work, "restaurado");
    const r = await backup.restoreBackup({ file: saved.path, documentsTarget: target });
    expect(await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).toMatchObject({ name: "Cliente preservado" });
    expect(digest(path.join(r.documents_root, ...version.storageKey.split("/")))).toBe(originalSha);
    expect(digest(original)).toBe(originalSha);
    expect((await backup.verifyBackup(r.safety_backup)).counts["public.Client"]).toBe(1);
  }, 30_000);

  it("refuses a truncated backup before changing data or creating restore files", async () => {
    const saved = await backup.createBackup({ dest: path.join(env.work, "para-truncar"), includeDocuments: true });
    const broken = path.join(env.work, "truncado.lawyermind-backup");
    const bytes = fs.readFileSync(saved.path); fs.writeFileSync(broken, bytes.subarray(0, Math.floor(bytes.length / 2)));
    const before = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    const target = path.join(env.work, "nao-criado");
    await expect(backup.restoreBackup({ file: broken, documentsTarget: target })).rejects.toMatchObject({ status: 422 });
    expect(await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).toEqual(before);
    expect(fs.existsSync(target)).toBe(false);
    expect(digest(original)).toBe(originalSha);
  }, 30_000);

  it("refuses changed migration history instead of reapplying SQL or losing data", async () => {
    addUpgrade();
    await migrate.runDesktopMigrations();
    fs.appendFileSync(path.join(migrationDir, upgradeName, "migration.sql"), "-- modified fixture\n");
    await expect(migrate.runDesktopMigrations()).rejects.toThrow("alterada depois de aplicada");
    expect(await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).toMatchObject({ name: "Cliente preservado" });
    expect(digest(original)).toBe(originalSha);
  });
});
