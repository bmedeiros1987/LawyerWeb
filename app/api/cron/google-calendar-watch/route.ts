import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registerCalendarWatch } from "@/lib/google/calendar";

export async function POST(request: NextRequest) {
  const secret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const threshold = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const connections = await prisma.googleCalendarConnection.findMany({
    where: { calendarId: { not: null }, OR: [{ watchExpiresAt: null }, { watchExpiresAt: { lt: threshold } }] },
    select: { id: true },
  });
  const results: Array<Record<string, unknown>> = [];
  for (const connection of connections) {
    try { results.push({ id: connection.id, ...(await registerCalendarWatch(connection.id)) }); }
    catch (error) { results.push({ id: connection.id, error: error instanceof Error ? error.message : "unknown" }); }
  }
  return NextResponse.json({ renewed: results.length, results });
}
