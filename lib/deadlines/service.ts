import { prisma } from "@/lib/prisma";
import { P, requirePermission, memberWithPermission } from "@/lib/authz/permissions";
import { deadlineScope } from "@/lib/authz/visibility";
import { deadlineRisk, reminderPlan, validateDeadlineDates } from "@/lib/deadlines/safety";

export async function canReceiveDeadline(userId: string, workspaceId: string, deadlineId: string) {
  const viewer = await memberWithPermission(userId, workspaceId, P.DEADLINES_VIEW);
  return Boolean(viewer && await prisma.deadline.findFirst({
    where: { id: deadlineId, AND: [deadlineScope(viewer)] }, select: { id: true },
  }));
}

export async function confirmDeadline(input: {
  deadlineId: string; workspaceId: string; confirmedByUserId: string;
  primaryResponsibleUserId: string; reviewerUserId?: string | null;
  dueAt: Date; internalDueAt?: Date | null; ruleSummary?: string | null;
}) {
  const viewer = await requirePermission(input.confirmedByUserId, input.workspaceId, P.DEADLINES_CONFIRM);
  validateDeadlineDates(input.dueAt, input.internalDueAt ?? null);
  if (!input.internalDueAt) throw new Error("Informe um prazo interno anterior ao prazo legal.");
  if (!input.reviewerUserId || input.reviewerUserId === input.primaryResponsibleUserId) {
    throw new Error("Escolha um revisor diferente do responsável.");
  }
  if (!input.ruleSummary?.trim()) throw new Error("Registre o fundamento do cálculo conferido.");

  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Deadline" WHERE id=${input.deadlineId} AND "workspaceId"=${input.workspaceId} FOR UPDATE`;
    const deadline = await tx.deadline.findFirst({ where: { id: input.deadlineId, AND: [deadlineScope(viewer)] } });
    if (!deadline) throw new Error("Prazo não encontrado ou sem acesso.");
    if (!["CANDIDATE", "PENDING_CONFIRMATION"].includes(deadline.status)) {
      throw new Error("Somente um prazo candidato pode ser confirmado.");
    }
    for (const userId of [input.primaryResponsibleUserId, input.reviewerUserId!]) {
      if (!await canReceiveDeadline(userId, input.workspaceId, deadline.id)) {
        throw new Error("Responsável e revisor precisam de acesso ativo ao prazo e ao processo.");
      }
    }
    const reminders = reminderPlan(input.dueAt, input.internalDueAt!);
    await tx.deadlineReminder.deleteMany({ where: { deadlineId: deadline.id, status: "PENDING" } });
    const updated = await tx.deadline.update({ where: { id: deadline.id }, data: {
      status: "CONFIRMED", risk: deadlineRisk(input.dueAt), dueAt: input.dueAt,
      internalDueAt: input.internalDueAt, primaryResponsibleUserId: input.primaryResponsibleUserId,
      reviewerUserId: input.reviewerUserId, confirmedAt: new Date(),
      confirmedByUserId: input.confirmedByUserId, ruleSummary: input.ruleSummary!.trim(),
    } });
    if (reminders.length) await tx.deadlineReminder.createMany({ data: reminders.flatMap(r =>
      [input.primaryResponsibleUserId, input.reviewerUserId!].map(recipientUserId => ({
        deadlineId: deadline.id, scheduledAt: r.at, channel: r.channel, stage: r.stage, recipientUserId,
      })),
    ) });
    await tx.activityLog.create({ data: {
      workspaceId: input.workspaceId, userId: input.confirmedByUserId, type: "DEADLINE_CONFIRMED",
      entityType: "Deadline", entityId: deadline.id, summary: `Prazo confirmado para ${input.dueAt.toISOString()}`,
      metadata: { matterId: deadline.matterId, primaryResponsibleUserId: input.primaryResponsibleUserId,
        reviewerUserId: input.reviewerUserId!, internalDueAt: input.internalDueAt!.toISOString() },
    } });
    return updated;
  }, { timeout: 15000 });
}

export async function completeDeadline(input: { deadlineId: string; workspaceId: string; userId: string }) {
  const viewer = await requirePermission(input.userId, input.workspaceId, P.DEADLINES_COMPLETE);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Deadline" WHERE id=${input.deadlineId} AND "workspaceId"=${input.workspaceId} FOR UPDATE`;
    const deadline = await tx.deadline.findFirst({ where: { id: input.deadlineId, AND: [deadlineScope(viewer)] } });
    if (!deadline) throw new Error("Prazo não encontrado ou sem acesso.");
    if (!["CONFIRMED", "IN_PROGRESS"].includes(deadline.status)) throw new Error("Confirme o prazo antes de concluí-lo.");
    const updated = await tx.deadline.update({ where: { id: deadline.id }, data: {
      status: "COMPLETED", risk: "NORMAL", completedAt: new Date(), completedByUserId: input.userId,
    } });
    await tx.deadlineReminder.updateMany({ where: { deadlineId: deadline.id, status: "PENDING" }, data: { status: "CANCELLED" } });
    await tx.activityLog.create({ data: {
      workspaceId: input.workspaceId, userId: input.userId, type: "DEADLINE_COMPLETED", entityType: "Deadline",
      entityId: deadline.id, summary: "Prazo concluído", metadata: { matterId: deadline.matterId },
    } });
    return updated;
  });
}
