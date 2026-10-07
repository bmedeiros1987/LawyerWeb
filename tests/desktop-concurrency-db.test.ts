// Concurrency of the desktop app against a real PostgreSQL:
//   login lockout cannot be bypassed by parallel requests,
//   a recovery key works exactly once,
//   simultaneous imports of new versions get distinct numbers and files.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { desktopTestEnv, type DesktopTestEnv } from "./helpers/desktop-db";

const RUN = process.env.RUN_DB_TESTS === "1";
/* eslint-disable @typescript-eslint/no-explicit-any */
const outcome = (p: Promise<unknown>) => p.then(() => 200, (e: any) => e.status ?? 500);

describe.skipIf(!RUN)("desktop concurrency", () => {
  let env: DesktopTestEnv;
  let auth: any, docs: any, prisma: any;
  const owner = { name: "Titular", email: "titular@exemplo.invalid", password: "senha-correta-123456" };
  let recoveryKey: string;

  beforeAll(async () => {
    env = await desktopTestEnv("conc");
    auth = await import("@/lib/desktop/auth");
    docs = await import("@/lib/desktop/documents");
    prisma = (await import("@/lib/prisma")).prisma;
    recoveryKey = (await auth.setupOwner(owner)).recoveryKey;
  }, 120_000);
  afterAll(async () => { await env?.cleanup(); });

  it("parallel wrong passwords get at most 5 checks; then even the right password is locked", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => outcome(auth.login(owner.email, `errada-${i}-xxxxxxxx`))));
    expect(results.filter(s => s === 401).length).toBeLessThanOrEqual(5);
    expect(results.filter(s => s === 429).length).toBeGreaterThanOrEqual(7);
    expect(results.every(s => s === 401 || s === 429)).toBe(true);
    expect(await outcome(auth.login(owner.email, owner.password))).toBe(429);
  }, 120_000);

  it("after the lock expires the count starts over and the right password works", async () => {
    await prisma.$executeRaw`update desktop.local_account set locked_until = now() - interval '1 minute'`;
    for (let i = 0; i < 4; i++) expect(await outcome(auth.login(owner.email, `errada-de-novo-${i}xx`))).toBe(401);
    expect(await outcome(auth.login(owner.email, owner.password))).toBe(200);
    const r = await prisma.$queryRaw`select failed_attempts, locked_until from desktop.local_account`;
    expect(r[0]).toMatchObject({ failed_attempts: 0, locked_until: null });
  }, 120_000);

  it("the same recovery key used in parallel works exactly once", async () => {
    const pw = (i: number) => `nova-senha-paralela-${i}-abc`;
    const results = await Promise.all([0, 1, 2, 3].map(i => auth.recoverOwner(owner.email, recoveryKey, pw(i)).then((r: any) => ({ i, r }), (e: any) => ({ i, status: e.status }))));
    const wins = results.filter(x => x.r);
    expect(wins).toHaveLength(1);
    expect(results.filter(x => !x.r).every(x => x.status === 409 || x.status === 401)).toBe(true);
    const winner = wins[0].i;
    for (const i of [0, 1, 2, 3]) {
      await prisma.$executeRaw`update desktop.local_account set failed_attempts = 0, locked_until = null`;
      expect(await outcome(auth.login(owner.email, pw(i)))).toBe(i === winner ? 200 : 401);
    }
    expect(await outcome(auth.recoverOwner(owner.email, recoveryKey, pw(9)))).toBe(401);
  }, 120_000);

  it("simultaneous imports of new versions of one document get distinct numbers and files", async () => {
    const u = await prisma.user.findFirst();
    const ws = await prisma.workspace.create({ data: { name: "Escritório", slug: `c-${env.dbName}` } });
    const src = (i: number) => { const f = path.join(env.work, `contrato-${i}.docx`); fs.writeFileSync(f, `versão ${i}`); return f; };
    const first = await docs.importDocument({ userId: u.id, workspaceId: ws.id, sourcePath: src(0), name: "Contrato" });
    const results = await Promise.all([1, 2, 3, 4, 5].map(i => docs.importDocument({ userId: u.id, workspaceId: ws.id, sourcePath: src(i), documentId: first.documentId })));
    expect(results.map((r: any) => r.version).sort()).toEqual([2, 3, 4, 5, 6]);
    for (const r of results as any[]) expect(fs.existsSync(path.join(env.state, "documentos", ...r.storageKey.split("/")))).toBe(true);
    const doc = await prisma.legalDocument.findUnique({ where: { id: first.documentId } });
    expect(doc.currentVersion).toBe(6);
  }, 120_000);
});
