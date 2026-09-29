import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, canAccessMatter, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";

const patchInput = z.object({
  workspaceId: z.string().optional(),
  title: z.string().trim().min(2).max(300).optional(),
  description: z.string().max(20000).nullable().optional(),
  priority: z.enum(["LOW","NORMAL","HIGH","CRITICAL"]).optional(),
  status: z.enum(["OPEN","IN_PROGRESS","WAITING","REVIEW","DONE","CANCELLED"]).optional(),
  assigneeUserId: z.string().nullable().optional(),
  reviewerUserId: z.string().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  startAt: z.coerce.date().nullable().optional(),
  private: z.boolean().optional(),
  estimatedMinutes: z.number().int().min(0).max(100000).nullable().optional(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const parsed = patchInput.parse(await request.json());
    const member = await requireActiveMembership(session.user.id, parsed.workspaceId);
    await requirePermission(session.user.id, member.workspaceId, P.TASKS_EDIT);
    const { id } = await context.params;
    const existing = await prisma.legalTask.findFirst({ where: { id, workspaceId: member.workspaceId } });
    if (!existing) return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });
    if (existing.matterId && !(await canAccessMatter(session.user.id, member.workspaceId, existing.matterId, P.MATTERS_VIEW))) {
      return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });
    }

    if (existing.private && ![existing.requesterUserId, existing.assigneeUserId, existing.reviewerUserId].includes(session.user.id)) {
      return NextResponse.json({ error: "Tarefa privada." }, { status: 403 });
    }

    for (const userId of [parsed.assigneeUserId, parsed.reviewerUserId]) {
      if (!userId) continue;
      const target = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: member.workspaceId, userId } } });
      if (!target || target.status !== "ACTIVE") return NextResponse.json({ error: "Usuário indicado não pertence ao workspace." }, { status: 400 });
    }

    const nextStatus = parsed.status;
    const { workspaceId: _workspaceId, ...changes } = parsed;
    const task = await prisma.$transaction(async (tx) => {
      const updated = await tx.legalTask.update({
        where: { id },
        data: {
          ...changes,
          completedAt: nextStatus ? (nextStatus === "DONE" ? new Date() : null) : undefined,
        },
      });
      await tx.activityLog.create({
        data: {
          workspaceId: member.workspaceId,
          userId: session.user.id,
          type: nextStatus === "DONE" ? "TASK_COMPLETED" : "TASK_UPDATED",
          entityType: "LegalTask",
          entityId: id,
          summary: nextStatus === "DONE" ? `Tarefa concluída: ${updated.title}` : `Tarefa atualizada: ${updated.title}`,
          metadata: { status: updated.status, assigneeUserId: updated.assigneeUserId, dueAt: updated.dueAt },
        },
      });
      return updated;
    });
    return NextResponse.json({ task });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status });
  }
}
