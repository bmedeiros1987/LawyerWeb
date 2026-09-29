import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { deleteVclEventFromGoogle, pushVclEventToGoogle } from "@/lib/google/calendar";

const patchInput = z.object({
  title: z.string().min(1).max(250).optional(),
  description: z.string().max(20000).nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  kind: z.enum(["DEADLINE", "HEARING", "MEETING", "TASK", "OTHER"]).optional(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const existing = await prisma.legalCalendarEvent.findFirst({ where: { id, userId: session.user.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const parsed = patchInput.parse(await request.json());
    const event = await prisma.legalCalendarEvent.update({ where: { id }, data: parsed });
    await pushVclEventToGoogle(id);
    return NextResponse.json({ event });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const existing = await prisma.legalCalendarEvent.findFirst({ where: { id, userId: session.user.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await deleteVclEventFromGoogle(id);
  await prisma.legalCalendarEvent.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
