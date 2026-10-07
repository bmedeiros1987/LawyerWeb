import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncCourt, initialState, type Scope, type Provider } from "@/lib/desktop/court-sync";
import { dataJudPage } from "@/lib/desktop/court-adapters";

const enabled = process.env.RUN_COURT_DB_TESTS === "1";
describe.skipIf(!enabled)("court store on an exclusive disposable PostgreSQL cluster", () => {
  let prisma: typeof import("@/lib/prisma")["prisma"];
  let store: typeof import("@/lib/desktop/court-store")["courtStore"];
  let state: typeof import("@/lib/desktop/court-store")["courtState"];
  let scope: Scope, otherWorkspace: Scope, otherMatter: Scope;
  let owner: string, responsible: string, operator: string, operatorRoleId: string;
  const fixture = (id: string) => ({ id, title: "Evento sintético", body: "Sem dados reais",
    occurredAt: "2026-10-07T10:00:00Z", evidence: { synthetic: true } });
  const provider = (id: string, cursor = id, complete = true): Provider => ({
    source: "DATAJUD", async read() { return { events: [fixture(id)], cursor, complete }; },
  });
  const count = () => prisma.courtCommunication.count({ where: { workspaceId: scope.workspaceId, matterId: scope.matterId } });

  beforeAll(async () => {
    // Refuse all writes until both provenance and server identity are verified.
    const raw = process.env.COURT_DB_MANIFEST;
    if (!raw || !process.env.COURT_DB_RUN_ID) throw new Error("Missing exclusive cluster provenance");
    const proof = JSON.parse(fs.readFileSync(raw, "utf8"));
    const url = new URL(process.env.DATABASE_URL!);
    if (!/^[a-f0-9]{32}$/.test(proof.runId) || proof.runId !== process.env.COURT_DB_RUN_ID ||
      proof.database !== "mblz_test_" + proof.runId || url.pathname !== "/" + proof.database ||
      url.hostname !== "127.0.0.1" || url.port !== String(proof.port) || url.search || url.hash ||
      proof.exclusive !== true || proof.disposable !== true || proof.expiresAt <= Date.now() ||
      proof.provisioner !== "scripts/validate-desktop-courts.mjs" ||
      process.env.MBLZ_DESKTOP_STATE_DIR !== proof.state ||
      !path.basename(path.dirname(proof.cluster)).startsWith("lm-court-exclusive-"))
      throw new Error("Invalid exclusive cluster provenance");
    const client = new pg.Client({ connectionString: url.toString() }); await client.connect();
    try {
      const server = (await client.query("select current_setting('data_directory') as directory, system_identifier::text from pg_control_system()")).rows[0];
      if (server.directory !== proof.cluster || server.system_identifier !== proof.systemId)
        throw new Error("Server does not match newly provisioned cluster");
    } finally { await client.end(); }
    const migrations = await import("@/lib/desktop/migrate");
    await migrations.runDesktopMigrations();
    prisma = (await import("@/lib/prisma")).prisma;
    const module = await import("@/lib/desktop/court-store"); store = module.courtStore; state = module.courtState;
    owner = (await prisma.user.create({ data: { name: "Titular sintético" } })).id;
    responsible = (await prisma.user.create({ data: { name: "Responsável sintético" } })).id;
    operator = (await prisma.user.create({ data: { name: "Operador sintético" } })).id;
    const ws = await prisma.workspace.create({ data: { name: "Workspace sintético", slug: "court-" + proof.runId } });
    const role = await prisma.workspaceRole.create({ data: { workspaceId: ws.id, name: "Fixture", permissions: { allow: ["matters.view"] } } });
    for (const userId of [owner, responsible]) await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId, roleId: role.id } });
    const operatorRole = await prisma.workspaceRole.create({ data: { workspaceId: ws.id, name: "Operador", permissions: { allow: ["matters.view"] } } });
    operatorRoleId = operatorRole.id;
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: operator, roleId: operatorRole.id } });
    const matter = await prisma.matter.create({ data: { workspaceId: ws.id, title: "Processo sintético", number: "00000000020268260000", ownerUserId: owner, responsibleUserId: responsible } });
    scope = { workspaceId: ws.id, matterId: matter.id, source: "DATAJUD", actorUserId: operator };
    const second = await prisma.matter.create({ data: { workspaceId: ws.id, title: "Outro processo sintético", number: "00000000120268260000", ownerUserId: owner } });
    otherMatter = { ...scope, matterId: second.id };
    const other = await prisma.workspace.create({ data: { name: "Outro workspace sintético", slug: "other-" + proof.runId } });
    const otherRole = await prisma.workspaceRole.create({ data: { workspaceId: other.id, name: "Operador", permissions: { allow: ["matters.view"] } } });
    await prisma.workspaceMember.create({ data: { workspaceId: other.id, userId: operator, roleId: otherRole.id } });
    const third = await prisma.matter.create({ data: { workspaceId: other.id, title: "Sem acesso", number: "00000000220268260000", ownerUserId: owner } });
    otherWorkspace = { ...scope, workspaceId: other.id, matterId: third.id };
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    if (enabled) { const db = await import("@/lib/desktop/db"); await db.pool().end(); }
    // Provisioner stops/discards the entire cluster, including uncertain commits.
  });

  it("concurrent redelivery commits one communication and two authorized notices", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => syncCourt(scope, provider("concurrent"), store)));
    expect(results.reduce((n, r) => n + r.imported, 0)).toBe(1);
    expect(results.reduce((n, r) => n + r.inAppNotified, 0)).toBe(2);
    expect(await count()).toBe(1);
    expect(await prisma.userNotification.count({ where: { workspaceId: scope.workspaceId } })).toBe(2);
  });
  it("same identity is isolated by matter, workspace and source", async () => {
    expect((await syncCourt(otherMatter, provider("concurrent"), store)).imported).toBe(1);
    const other = await syncCourt(otherWorkspace, provider("concurrent"), store);
    expect(other.imported).toBe(1); expect(other.inAppNotified).toBe(0);
    const djen: Provider = { ...provider("concurrent"), source: "DJEN" };
    expect((await syncCourt({ ...scope, source: "DJEN" }, djen, store)).imported).toBe(1);
    expect((await state(otherMatter)).cursor).toBe("concurrent");
  });
  it("partial batch does not advance cursor; provider failure preserves success", async () => {
    const before = await state(scope);
    const partial = await syncCourt(scope, provider("partial", "unsafe", false), store);
    expect(partial.state.cursor).toBe(before.cursor); expect(partial.state.lastSuccess).toBe(before.lastSuccess);
    const failed: Provider = { source: "DATAJUD", async read() { throw new Error("synthetic provider failure"); } };
    const result = await syncCourt(scope, failed, store);
    expect(result.state.cursor).toBe(before.cursor); expect(result.state.lastSuccess).toBe(before.lastSuccess);
    expect(result.state.status).toBe("unavailable");
    expect((await syncCourt(scope, provider("partial", "safe"), store)).imported).toBe(0);
    expect((await state(scope)).cursor).toBe("safe");
  });
  it("notification SQL fault rolls back communication and cursor then retries", async () => {
    const fault = "court_fault_" + crypto.randomBytes(12).toString("hex");
    const before = await state(scope), previousCount = await count();
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('create function "' + fault + '"() returns trigger as $$ begin raise exception \'synthetic notification fault\'; end; $$ language plpgsql');
      await tx.$executeRawUnsafe('create trigger "' + fault + '" before insert on "UserNotification" for each row execute function "' + fault + '"()');
    });
    try {
      await expect(syncCourt(scope, provider("retry"), store)).rejects.toThrow();
      expect(await count()).toBe(previousCount); expect(await state(scope)).toEqual(before);
    } finally {
      await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('drop trigger "' + fault + '" on "UserNotification"');
        await tx.$executeRawUnsafe('drop function "' + fault + '"()');
      });
    }
    expect((await syncCourt(scope, provider("retry"), store)).inAppNotified).toBe(2);
  });
  it("real DataJud baseline never floods historical notices, even beyond 200 or out of order", async () => {
    const matter = await prisma.matter.create({ data: { workspaceId: scope.workspaceId, title: "Baseline sintético", number: "00000000420268260000", ownerUserId: owner } });
    const selected = { ...scope, matterId: matter.id };
    const process = { id: "synthetic-baseline", numeroProcesso: matter.number, movimentos:
      Array.from({ length: 350 }, (_, codigo) => ({ codigo, nome: "Histórico sintético", dataHora: "2026-10-01T10:00:00Z" })) };
    const p: Provider = { source: "DATAJUD", async read(cursor) { return dataJudPage(matter.number!, process, cursor); } };
    expect(await syncCourt(selected, p, store)).toMatchObject({ imported: 1, inAppNotified: 0 });
    process.movimentos.reverse();
    expect(await syncCourt(selected, p, store)).toMatchObject({ imported: 0, inAppNotified: 0 });
    process.movimentos.push({ codigo: 999, nome: "Nova identidade sintética", dataHora: "2026-10-02T10:00:00Z" });
    expect(await syncCourt(selected, p, store)).toMatchObject({ imported: 1, inAppNotified: 1 });
    process.movimentos.push({ codigo: 1000, nome: "Identidade atrasada sintética", dataHora: "2026-09-01T10:00:00Z" });
    expect(await syncCourt(selected, p, store)).toMatchObject({ imported: 1, inAppNotified: 1 });
    expect(await syncCourt(selected, p, store)).toMatchObject({ imported: 0, inAppNotified: 0 });
    expect(await prisma.courtCommunication.count({ where: { matterId: matter.id } })).toBe(3);
  });
  it("real bounded DataJud checkpoints drain 201 new identities exactly once", async () => {
    const matter = await prisma.matter.create({ data: { workspaceId: scope.workspaceId, title: "Lote sintético", number: "00000000520268260000", ownerUserId: owner } });
    const selected = { ...scope, matterId: matter.id };
    const process = { id: "synthetic-batches", numeroProcesso: matter.number, movimentos: [{ codigo: 0, nome: "Baseline" }] };
    const p: Provider = { source: "DATAJUD", async read(cursor) { return dataJudPage(matter.number!, process, cursor); } };
    const first = await syncCourt(selected, p, store);
    process.movimentos.push(...Array.from({ length: 201 }, (_, i) => ({ codigo: i + 1, nome: "Novo sintético" })));
    const partial = await syncCourt(selected, p, store);
    expect(partial.inAppNotified).toBe(200); expect(partial.state.cursor).toBe(first.state.cursor);
    expect((await state(selected)).resumeCursor).toBe(partial.state.resumeCursor);
    process.movimentos.reverse();
    const complete = await syncCourt(selected, p, store);
    expect(complete.inAppNotified).toBe(1); expect(complete.state.status).toBe("success");
    expect((await state(selected)).resumeCursor).toBeNull();
    expect((await syncCourt(selected, p, store)).inAppNotified).toBe(0);
  });
  it("actor revocation after scope creation blocks provider I/O inside the transaction", async () => {
    let calls = 0;
    const p: Provider = { source: "DATAJUD", async read() { calls++; return { events: [], cursor: null, complete: true }; } };
    const copiedScope = { ...scope };
    const memberKey = { workspaceId_userId: { workspaceId: scope.workspaceId, userId: operator } };
    await prisma.workspaceMember.update({ where: memberKey, data: { status: "SUSPENDED" } });
    try { await expect(syncCourt(copiedScope, p, store)).rejects.toMatchObject({ status: 404 }); }
    finally { await prisma.workspaceMember.update({ where: memberKey, data: { status: "ACTIVE" } }); }
    await prisma.workspaceRole.update({ where: { id: operatorRoleId }, data: { permissions: { allow: [] } } });
    try { await expect(syncCourt(copiedScope, p, store)).rejects.toMatchObject({ status: 404 }); }
    finally { await prisma.workspaceRole.update({ where: { id: operatorRoleId }, data: { permissions: { allow: ["matters.view"] } } }); }
    expect(calls).toBe(0);
  });
  it("recipient without permission is excluded; revoked membership receives no notice", async () => {
    await prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: scope.workspaceId, userId: responsible } }, data: { status: "SUSPENDED" } });
    expect((await syncCourt(scope, provider("revoked"), store)).inAppNotified).toBe(1);
    const member = await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: scope.workspaceId, userId: owner } } });
    await prisma.workspaceRole.update({ where: { id: member.roleId! }, data: { permissions: { allow: [] } } });
    expect((await syncCourt(scope, provider("no-permission"), store)).inAppNotified).toBe(0);
  });
  it("secret/inactive/missing-number and workspace mismatch make zero provider calls", async () => {
    let calls = 0; const p = { ...provider("forbidden"), async read() { calls++; return { events: [], cursor: null, complete: true }; } };
    for (const update of [{ secrecy: true }, { secrecy: false, status: "ARCHIVED" }, { status: "ACTIVE", number: null }]) {
      await prisma.matter.update({ where: { id: otherMatter.matterId }, data: update });
      expect((await syncCourt(otherMatter, p, store)).skipped).toBe(true);
    }
    const mismatch = { ...scope, workspaceId: otherWorkspace.workspaceId };
    expect((await syncCourt(mismatch, p, store)).skipped).toBe(true);
    expect(await state(mismatch)).toEqual(initialState()); expect(calls).toBe(0);
  });
  it("persists provider date and capture timestamp; never creates legal deadlines", async () => {
    const row = await prisma.courtCommunication.findFirstOrThrow({ where: { workspaceId: scope.workspaceId, matterId: scope.matterId, source: "DATAJUD" } });
    expect(row.publishedAt?.toISOString()).toBe("2026-10-07T10:00:00.000Z");
    expect(row.receivedAt).toBeInstanceOf(Date);
    expect(row.payload).toMatchObject({ provider: "DATAJUD", sourceDateRaw: "2026-10-07T10:00:00Z", deadlineSafety: "NO_AUTOMATIC_DEADLINE" });
    expect(await prisma.deadline.count()).toBe(0); expect(await prisma.matterMovement.count()).toBe(0);
  });
  it.skipIf(!process.env.COURT_UI_FIXTURE_FILE)("prepares isolated synthetic UI account without outbound services", async () => {
    const auth = await import("@/lib/desktop/auth");
    const email = "court-ui@example.invalid", password = "Synthetic-Only-2026";
    const account = await auth.setupOwner({ name: "Revisão sintética", email, password });
    const ws = await prisma.workspace.create({ data: { name: "Revisão sintética", slug: "ui-court-" + crypto.randomBytes(8).toString("hex") } });
    const role = await prisma.workspaceRole.create({ data: { workspaceId: ws.id, name: "Titular", permissions: { allow: ["*"] } } });
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: account.userId, roleId: role.id } });
    const matter = await prisma.matter.create({ data: { workspaceId: ws.id, title: "Processo de revisão — dados sintéticos", number: "00000000320268260000", ownerUserId: account.userId } });
    fs.writeFileSync(process.env.COURT_UI_FIXTURE_FILE!, JSON.stringify({ email, matterId: matter.id, otherMatterId: scope.matterId }));
  });
});
