// Per-computer settings (never part of a backup).
//
// The working-copy folder lives in the database (desktop.local_setting), so a
// restore switches it in the SAME transaction that replaces the rows: either
// both the data and the folder change, or neither does. settings.json is only
// read as a fallback for installations created before that table existed.
import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { desktopStateDir } from "./env";
import { withClient } from "./db";

export type DesktopSettings = { documentsRoot?: string };

const file = () => path.join(desktopStateDir(), "settings.json");

export function readSettings(): DesktopSettings {
  try { return JSON.parse(fs.readFileSync(file(), "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}; throw e; }
}

const KEY = "documents_root";
export const defaultDocumentsRoot = () => path.join(desktopStateDir(), "documentos");

/** Working-copy store: app-managed, outside any synced folder. Default: inside the app data dir. */
export async function documentsRoot(client?: PoolClient): Promise<string> {
  const read = async (c: PoolClient) => (await c.query<{ value: string }>("select value from desktop.local_setting where key = $1", [KEY])).rows[0]?.value;
  const value = client ? await read(client) : await withClient(read);
  return value ?? readSettings().documentsRoot ?? defaultDocumentsRoot();
}

/** Pass the transaction's client to make the change part of it. */
export async function setDocumentsRoot(value: string, client?: PoolClient): Promise<void> {
  const write = (c: PoolClient) => c.query(
    `insert into desktop.local_setting (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value, updated_at = now()`, [KEY, value]);
  if (client) await write(client); else await withClient(write);
}
