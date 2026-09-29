import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { pushMBLZEventToGoogle } from "@/lib/google/calendar";

const input = z.object({
  title: z.string().min(1).max(250),
  description: z.string().max(20000).optional(),
  location: z.string().max(500).optional(),
  kind: z.enum(["DEADLINE", "HEARING", "MEETING", "TASK", "OTHER"]).default("OTHER"),
  allDay: z.boolean().default(false),
  start: z.string().min(1),
  end: z.string().min(1),
  timeZone: z.string().default("America/Sao_Paulo"),
});

function normalizeDates(parsed: z.infer<typeof input>) {
  if (parsed.allDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.start) || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.end)) {
      throw new Error("All-day events require YYYY-MM-DD dates");
    }
    if (parsed.end <= parsed.start) throw new Error("All-day end must be after start; Google uses an exclusive end date");
    return { startDate: parsed.start, endDate: parsed.end, startAt: null, endAt: null };
  }
  const startAt = new Date(parsed.start);
  const endAt = new Date(parsed.end);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    throw new Error("Invalid event date range");
  }
  return { startDate: null, endDate: null, startAt, endAt };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const events = await prisma.legalCalendarEvent.findMany({
    where: { userId: session.user.id, status: { not: "CANCELLED" } },
    orderBy: [{ startAt: "asc" }, { startDate: "asc" }],
    take: 250,
  });
  return NextResponse.json({ events });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const parsed = input.parse(await request.json());
    const event = await prisma.legalCalendarEvent.create({
      data: {
        userId: session.user.id,
        title: parsed.title,
        description: parsed.description,
        location: parsed.location,
        kind: parsed.kind,
        allDay: parsed.allDay,
        timeZone: parsed.timeZone,
        ...normalizeDates(parsed),
      },
    });
    await pushMBLZEventToGoogle(event.id);
    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}
