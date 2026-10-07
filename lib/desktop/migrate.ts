// Applies the Prisma migration SQL shipped with the app, at startup, before
// the server accepts requests (see instrumentation.ts).
//
// Non-destructive by construction:
//  - only migrations not yet recorded are applied, each in its own transaction;
//  - a recorded migration whose SQL changed aborts startup (never re-applied);
//  - SQL with DROP / TRUNCATE / DELETE / RENAME is refused;
//  - before applying anything to a database that already has data, a
//    rows-only backup is written to <state>/backups/antes-da-migracao-*.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { backupsDir, DesktopError, migrationsDir } from "./env";
import { withClient } from "./db";

export const DESTRUCTIVE = /\b(drop\s+(table|column|schema|type|index|constraint|view)|truncate|delete\s+from|rename\s+(to|column))\b/i;

export const DESKTOP_DDL = `
create table if not exists desktop.local_account (
  user_id text primary key references public."User"(id) on delete cascade,
  email_normalized text not null unique,
  password_hash text not null,
  is_owner boolean not null default false,
  recovery_hash text,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists local_account_single_owner on desktop.local_account ((true)) where is_owner;
create table if not exists desktop.local_session (
  token_hash text primary key,
  user_id text not null references public."User"(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists local_session_user on desktop.local_session (user_id);
`;

type Migration = { name: string; sql: string; sha256: string };

export function shippedMigrations(): Migration[] {
  const dir = migrationsDir();
  // Runtime directory chosen by the desktop shell; not part of the build trace.
  return fs.readdirSync(/*turbopackIgnore: true*/ dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(/*turbopackIgnore: true*/ path.join(dir, d.name, "migration.sql")))
    .map(d => d.name).sort()
    .map(name => {
      const sql = fs.readFileSync(/*turbopackIgnore: true*/ path.join(dir, name, "migration.sql"), "utf8");
      return { name, sql, sha256: crypto.createHash("sha256").update(sql).digest("hex") };
    });
}

async function ensureLedger(c: PoolClient) {
  await c.query(`create schema if not exists desktop;
    create table if not exists desktop.schema_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now())`);
}

export async function appliedMigrations(c: PoolClient): Promise<string[]> {
  const r = await c.query<{ name: string }>(`select name from desktop.schema_migrations order by name`);
  return r.rows.map(x => x.name);
}

async function hasUserData(c: PoolClient): Promise<boolean> {
  const t = await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='User'`);
  if (!t.rowCount) return false;
  return Boolean((await c.query(`select 1 from public."User" limit 1`)).rowCount);
}

export type MigrationResult = { applied: string[]; preMigrationBackup?: string };

export async function runDesktopMigrations(log: (m: string) => void = () => {}): Promise<MigrationResult> {
  const shipped = shippedMigrations();
  const pending = await withClient(async c => {
    await c.query("select pg_advisory_lock(7310)");
    await ensureLedger(c);
    const rows = (await c.query<{ name: string; sha256: string }>(`select name, sha256 from desktop.schema_migrations`)).rows;
    const known = new Map(rows.map(r => [r.name, r.sha256]));
    for (const [name, digest] of known) {
      const s = shipped.find(m => m.name === name);
      if (!s) throw new DesktopError(`O banco tem a migração ${name}, que esta versão do aplicativo não conhece. Use a versão mais recente do LawyerMind.`, 500);
      if (s.sha256 !== digest) throw new DesktopError(`A migração ${name} foi alterada depois de aplicada. Inicialização interrompida para proteger os dados.`, 500);
    }
    const todo = shipped.filter(m => !known.has(m.name));
    for (const m of todo) if (DESTRUCTIVE.test(m.sql)) throw new DesktopError(`A migração ${m.name} contém operação destrutiva e não será aplicada automaticamente.`, 500);
    const withData = await hasUserData(c);
    await c.query("select pg_advisory_unlock(7310)");
    return { todo, withData };
  });

  const result: MigrationResult = { applied: [] };
  if (pending.todo.length && pending.withData) {
    const { createBackup, EXTENSION } = await import("./backup");
    fs.mkdirSync(backupsDir(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const b = await createBackup({ dest: path.join(backupsDir(), `antes-da-migracao-${stamp}${EXTENSION}`), includeDocuments: false });
    result.preMigrationBackup = b.path;
    log(`backup antes da migração: ${b.path}`);
  }

  await withClient(async c => {
    await c.query("select pg_advisory_lock(7310)");
    try {
      for (const m of pending.todo) {
        await c.query("begin");
        try {
          await c.query(m.sql);
          await c.query(`insert into desktop.schema_migrations (name, sha256) values ($1, $2)`, [m.name, m.sha256]);
          await c.query("commit");
          result.applied.push(m.name);
          log(`migração aplicada: ${m.name}`);
        } catch (e) { await c.query("rollback"); throw e; }
      }
      await c.query(DESKTOP_DDL);
    } finally { await c.query("select pg_advisory_unlock(7310)"); }
  });
  return result;
}
