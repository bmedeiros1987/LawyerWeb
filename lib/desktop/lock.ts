// One lock for the working-copy store, held in PostgreSQL (session advisory
// lock, so it also covers a second server process). Imports take it shared;
// backup, restore and relocation take it exclusively. A backup therefore never
// runs while a copy is being imported, restored or the folder relocated.
import { DesktopError } from "./env";
import { pool } from "./db";

const STORE_LOCK = 7311;

export async function withStoreLock<T>(mode: "shared" | "exclusive", fn: () => Promise<T>, timeoutMs = 60_000): Promise<T> {
  const c = await pool().connect();
  const suffix = mode === "shared" ? "_shared" : "";
  try {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const r = await c.query<{ ok: boolean }>(`select pg_try_advisory_lock${suffix}($1) as ok`, [STORE_LOCK]);
      if (r.rows[0].ok) break;
      if (Date.now() >= end) throw new DesktopError("Outra operação com os documentos (importação, backup, restauração ou relocalização) está em andamento. Tente de novo em instantes.", 409, "busy");
      await new Promise(res => setTimeout(res, 200));
    }
    try { return await fn(); }
    finally { await c.query(`select pg_advisory_unlock${suffix}($1)`, [STORE_LOCK]); }
  } finally { c.release(); }
}
