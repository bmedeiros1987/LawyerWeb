import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";

const input = z.object({
  workspaceId: z.string().optional(),
  clientId: z.string().optional(),
  number: z.string().trim().max(80).optional(),
  internalCode: z.string().trim().max(80).optional(),
  title: z.string().trim().min(2).max(240),
  type: z.string().trim().max(80).default("LITIGATION"),
  practiceArea: z.string().trim().max(100).optional(),
  court: z.string().trim().max(120).optional(),
  jurisdiction: z.string().trim().max(120).optional(),
  courtUnit: z.string().trim().max(160).optional(),
  responsibleUserId: z.string().optional(),
  phase: z.string().trim().max(120).optional(),
  secrecy: z.boolean().default(false),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const member = await requireActiveMembership(session.user.id, request.nextUrl.searchParams.get("workspaceId"));
    await requirePermission(session.user.id, member.workspaceId, P.MATTERS_VIEW);
    const q = request.nextUrl.searchParams.get("q")?.trim();
    const matters = await prisma.matter.findMany({
      where: {
        workspaceId: member.workspaceId,
        AND: [
          { OR: [{ secrecy: false }, { access: { some: { memberId: member.id } } }] },
          ...(q ? [{ OR: [
            { number: { contains: q, mode: "insensitive" as const } },
            { internalCode: { contains: q, mode: "insensitive" as const } },
            { title: { contains: q, mode: "insensitive" as const } },
            { client: { name: { contains: q, mode: "insensitive" as const } } },
          ] }] : []),
        ],
      },
      include: {
        client: { select: { id: true, name: true } },
        _count: { select: { tasks: true, deadlines: true, documents: true, communications: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ workspaceId: member.workspaceId, matters });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const parsed = input.parse(await request.json());
    const member = await requireActiveMembership(session.user.id, parsed.workspaceId);
    await requirePermission(session.user.id, member.workspaceId, P.MATTERS_EDIT);

    if (parsed.clientId) {
      const client = await prisma.client.findFirst({ where: { id: parsed.clientId, workspaceId: member.workspaceId } });
      if (!client) return NextResponse.json({ error: "Cliente inválido para este workspace." }, { status: 400 });
    }
    if (parsed.responsibleUserId) {
      const responsible = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: member.workspaceId, userId: parsed.responsibleUserId } },
      });
      if (!responsible || responsible.status !== "ACTIVE") return NextResponse.json({ error: "Responsável inválido." }, { status: 400 });
    }

    const matter = await prisma.$transaction(async (tx) => {
      const created = await tx.matter.create({
        data: {
          workspaceId: member.workspaceId,
          clientId: parsed.clientId || null,
          number: parsed.number || null,
          internalCode: parsed.internalCode || null,
          title: parsed.title,
          type: parsed.type,
          practiceArea: parsed.practiceArea || null,
          court: parsed.court || null,
          jurisdiction: parsed.jurisdiction || null,
          courtUnit: parsed.courtUnit || null,
          responsibleUserId: parsed.responsibleUserId || session.user.id,
          ownerUserId: session.user.id,
          phase: parsed.phase || null,
          secrecy: parsed.secrecy,
        },
      });
      if (created.secrecy) {
        await tx.matterAccess.create({ data: { matterId: created.id, memberId: member.id, access: "EDIT" } });
      }
      await tx.activityLog.create({
        data: {
          workspaceId: member.workspaceId,
          userId: session.user.id,
          type: "MATTER_CREATED",
          entityType: "Matter",
          entityId: created.id,
          summary: `Processo/assunto cadastrado: ${created.title}`,
          metadata: { number: created.number, secrecy: created.secrecy },
        },
      });
      return created;
    });
    return NextResponse.json({ matter }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status });
  }
}
