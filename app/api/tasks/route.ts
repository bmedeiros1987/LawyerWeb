import { taskScope } from "@/lib/authz/visibility";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, canAccessMatter, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";

const createInput = z.object({
  workspaceId: z.string().optional(),
  matterId: z.string().optional(),
  title: z.string().trim().min(2).max(300),
  description: z.string().max(20000).optional(),
  priority: z.enum(["LOW","NORMAL","HIGH","CRITICAL"]).default("NORMAL"),
  assigneeUserId: z.string().optional(),
  reviewerUserId: z.string().optional(),
  dueAt: z.coerce.date().optional(),
  startAt: z.coerce.date().optional(),
  private: z.boolean().default(false),
  estimatedMinutes: z.number().int().min(0).max(100000).optional(),
});

async function validateMember(workspaceId: string, userId?: string) {
  if (!userId) return null;
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!member || member.status !== "ACTIVE") throw new Error("Usuário indicado não pertence ao workspace.");
  return member;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const member = await requireActiveMembership(session.user.id, request.nextUrl.searchParams.get("workspaceId"));
    await requirePermission(session.user.id, member.workspaceId, P.TASKS_VIEW);
    const scope = request.nextUrl.searchParams.get("scope") ?? "mine";
    const status = request.nextUrl.searchParams.get("status");
    const q = request.nextUrl.searchParams.get("q")?.trim();

    const visibility = {
      OR: [
        { private: false },
        { requesterUserId: session.user.id },
        { assigneeUserId: session.user.id },
        { reviewerUserId: session.user.id },
      ],
    };

    const scopeFilter =
      scope === "requested" ? { requesterUserId: session.user.id } :
      scope === "assigned" ? { assigneeUserId: session.user.id } :
      scope === "unassigned" ? { assigneeUserId: null } :
      scope === "all" ? {} :
      { OR: [{ requesterUserId: session.user.id }, { assigneeUserId: session.user.id }, { assigneeUserId: null }] };

    const tasks = await prisma.legalTask.findMany({
      where: {
        workspaceId: member.workspaceId,
        AND: [
          taskScope(member),
          { OR: [{ matterId: null }, { matter: { secrecy: false } }, { matter: { access: { some: { memberId: member.id } } } }] },
          scopeFilter,
          ...(status ? [{ status: status as never }] : []),
          ...(q ? [{ OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
            { matter: { title: { contains: q, mode: "insensitive" as const } } },
            { matter: { number: { contains: q, mode: "insensitive" as const } } },
          ] }] : []),
        ],
      },
      include: { matter: { select: { id: true, number: true, title: true, secrecy: true } } },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 250,
    });
    return NextResponse.json({ workspaceId: member.workspaceId, tasks });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const parsed = createInput.parse(await request.json());
    const member = await requireActiveMembership(session.user.id, parsed.workspaceId);
    await requirePermission(session.user.id, member.workspaceId, P.TASKS_EDIT);

    if (parsed.matterId) {
      const allowed = await canAccessMatter(session.user.id, member.workspaceId, parsed.matterId, P.MATTERS_VIEW);
      if (!allowed) return NextResponse.json({ error: "Processo/assunto inválido ou sem acesso." }, { status: 400 });
    }
    await validateMember(member.workspaceId, parsed.assigneeUserId);
    await validateMember(member.workspaceId, parsed.reviewerUserId);
    for(const userId of [parsed.assigneeUserId||session.user.id,parsed.reviewerUserId]){
      if(!userId)continue;
      await requirePermission(userId,member.workspaceId,P.TASKS_VIEW);
      if(parsed.matterId&&!(await canAccessMatter(userId,member.workspaceId,parsed.matterId,P.MATTERS_VIEW)))throw new Error("Encarregado/revisor sem acesso ao processo.");
    }
    if (parsed.dueAt && parsed.startAt && parsed.dueAt < parsed.startAt) {
      return NextResponse.json({ error: "A data final deve ser posterior ao início." }, { status: 400 });
    }

    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.legalTask.create({
        data: {
          workspaceId: member.workspaceId,
          matterId: parsed.matterId || null,
          title: parsed.title,
          description: parsed.description || null,
          priority: parsed.priority,
          requesterUserId: session.user.id,
          assigneeUserId: parsed.assigneeUserId || session.user.id,
          reviewerUserId: parsed.reviewerUserId || null,
          dueAt: parsed.dueAt || null,
          startAt: parsed.startAt || null,
          private: parsed.private,
          estimatedMinutes: parsed.estimatedMinutes,
        },
      });
      await tx.activityLog.create({
        data: {
          workspaceId: member.workspaceId,
          userId: session.user.id,
          type: "TASK_CREATED",
          entityType: "LegalTask",
          entityId: created.id,
          summary: `Tarefa criada: ${created.title}`,
          metadata: { assigneeUserId: created.assigneeUserId, matterId: created.matterId, dueAt: created.dueAt },
        },
      });
      return created;
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status });
  }
}
