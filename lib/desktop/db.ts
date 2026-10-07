// Direct PostgreSQL access for desktop administration (migrations, backup,
// restore). Application data access keeps using Prisma.
import { Pool, type PoolClient } from "pg";

const g = globalThis as unknown as { desktopPool?: Pool };

export function pool(): Pool {
  if (!g.desktopPool) g.desktopPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
  return g.desktopPool;
}

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try { return await fn(c); } finally { c.release(); }
}

export const qi = (name: string) => '"' + name.replace(/"/g, '""') + '"';
