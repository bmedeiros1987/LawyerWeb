import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startGmailWatch } from "@/lib/google/gmail";

export async function POST(request: NextRequest) {
  const secret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const threshold = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const connections = await prisma.googleGmailConnection.findMany({
    where: { OR: [{ watchExpiresAt: null }, { watchExpiresAt: { lt: threshold } }] },
    select: { id: true },
    take: 1000,
  });

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const c of connections) {
    try {
      await startGmailWatch(c.id);
      results.push({ id: c.id, ok: true });
    } catch (error) {
      results.push({ id: c.id, ok: false, error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return NextResponse.json({ renewed: results.filter((r) => r.ok).length, results });
}
