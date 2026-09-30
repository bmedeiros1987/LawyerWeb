import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await prisma.$queryRaw<Array<{ connected: boolean; user_table: boolean; migrations_table: boolean }>>`
      SELECT
        true AS connected,
        to_regclass('public."User"') IS NOT NULL AS user_table,
        to_regclass('public."_prisma_migrations"') IS NOT NULL AS migrations_table
    `;
    const row = rows[0];
    if (!row?.connected) {
      return NextResponse.json({ ok: false, database: "unreachable" }, { status: 503 });
    }
    const schemaReady = Boolean(row.user_table);
    return NextResponse.json({
      ok: schemaReady,
      database: "reachable",
      schema: schemaReady ? "ready" : "pending",
      migrations: row.migrations_table ? "tracked" : "not_tracked",
    }, { status: schemaReady ? 200 : 503 });
  } catch {
    return NextResponse.json({ ok: false, database: "unreachable", schema: "unknown" }, { status: 503 });
  }
}
