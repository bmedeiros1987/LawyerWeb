// Throw-away PostgreSQL database + desktop environment for integration tests
// of lib/desktop (restore replaces every table, so never the shared test DB).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

export type DesktopTestEnv = { dbName: string; tmp: string; state: string; work: string; cleanup: () => Promise<void> };

export async function desktopTestEnv(prefix: string): Promise<DesktopTestEnv> {
  const adminUrl = process.env.DATABASE_URL!;
  const dbName = `lm_${prefix}_${crypto.randomBytes(4).toString("hex")}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `lm-${prefix}-`));
  const state = path.join(tmp, "estado"), work = path.join(tmp, "trabalho");
  for (const d of [state, work]) fs.mkdirSync(d, { recursive: true });
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect(); await admin.query(`create database ${dbName}`); await admin.end();
  const url = new URL(adminUrl); url.pathname = "/" + dbName;
  Object.assign(process.env, {
    DATABASE_URL: url.toString(), MBLZ_DESKTOP: "1", MBLZ_DESKTOP_STATE_DIR: state, MBLZ_DESKTOP_NO_LAUNCH: "1",
    MBLZ_DESKTOP_MIGRATIONS_DIR: path.resolve("prisma/migrations"),
  });
  const { runDesktopMigrations } = await import("@/lib/desktop/migrate");
  await runDesktopMigrations();
  return {
    dbName, tmp, state, work,
    cleanup: async () => {
      await (await import("@/lib/prisma")).prisma.$disconnect();
      await (await import("@/lib/desktop/db")).pool().end();
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect(); await a.query(`drop database if exists ${dbName} with (force)`); await a.end();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}
