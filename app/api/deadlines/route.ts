import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";

const createInput = z.object({
  workspaceId: z.string().min(1),
  matterId: z.string().min(1).optional(),
  communicationId: z.string().min(1).optional(),
  title: z.string().trim().min(2).max(300),
  description: z.string().max(20000).optional(),
  source: z.string().max(80).optional(),
  sourceReference: z.string().max(500).optional(),
  legalStartAt: z.coerce.date().optional(),
  dueAt: z.coerce.date().optional(),
  ruleSummary: z.string().max(10000).optional(),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  try {
    await requirePermission(session.user.id, workspaceId, P.DEADLINES_VIEW);
    const deadlines = await prisma.deadline.findMany({
      where: { workspaceId },
      orderBy: [{ risk: "desc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      take: 250,
    });
    return NextResponse.json({ deadlines });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Forbidden" }, { status: 403 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const parsed = createInput.parse(await request.json());
    await requirePermission(session.user.id, parsed.workspaceId, P.DEADLINES_CREATE);
    const deadline = await prisma.deadline.create({
      data: {
        workspaceId: parsed.workspaceId,
        matterId: parsed.matterId,
        communicationId: parsed.communicationId,
        title: parsed.title,
        description: parsed.description,
        source: parsed.source ?? "MANUAL",
        sourceReference: parsed.sourceReference,
        legalStartAt: parsed.legalStartAt,
        dueAt: parsed.dueAt,
        ruleSummary: parsed.ruleSummary,
        status: "CANDIDATE",
        risk: "ATTENTION",
      },
    });
    await prisma.activityLog.create({
      data: { workspaceId: parsed.workspaceId, userId: session.user.id, type: "DEADLINE_CANDIDATE_CREATED", entityType: "Deadline", entityId: deadline.id, summary: `Prazo candidato criado: ${deadline.title}` },
    });
    return NextResponse.json({ deadline }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status });
  }
}
