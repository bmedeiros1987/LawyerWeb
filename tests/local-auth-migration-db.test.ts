import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { requireDisposablePilotDatabase } from "./e2e/database-guard";

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("atomic local-auth migration in disposable PostgreSQL schema", () => {
  it("rolls back every new object on legacy email collisions and preserves both existing users", async () => {
    requireDisposablePilotDatabase({ ...process.env, RUN_PILOT_E2E: "1" });
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    const schema = `synthetic_auth_migration_${randomUUID().replaceAll("-", "")}`;
    try {
      const migration = await readFile("prisma/migrations/20261004010000_local_auth/migration.sql", "utf8");
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      await client.query('CREATE TABLE "User" (id TEXT PRIMARY KEY, email TEXT)');
      await client.query('INSERT INTO "User" (id, email) VALUES ($1,$2),($3,$4)', ["synthetic-a", "same@example.invalid", "synthetic-b", "SAME@example.invalid"]);
      await expect(client.query(migration)).rejects.toMatchObject({ code: "23505" });
      await client.query("ROLLBACK");
      expect((await client.query('SELECT id, email FROM "User" ORDER BY id')).rows).toEqual([
        { id: "synthetic-a", email: "same@example.invalid" }, { id: "synthetic-b", email: "SAME@example.invalid" },
      ]);
      expect((await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema=$1 AND table_name <> 'User'", [schema])).rows[0].count).toBe(0);
      // Only the isolated test fixture is changed to exercise the successful path; no real reconciliation.
      await client.query('UPDATE "User" SET email=$1 WHERE id=$2', ["different@example.invalid", "synthetic-b"]);
      await client.query(migration);
      expect((await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema=$1 AND table_name LIKE 'Local%'", [schema])).rows[0].count).toBe(5);
      expect((await client.query('SELECT count(*)::int AS count FROM "User"')).rows[0].count).toBe(2);
    } finally {
      await client.query("ROLLBACK");
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      client.release(); await pool.end();
    }
  });
});
