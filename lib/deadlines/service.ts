import { prisma } from "@/lib/prisma";
import { deadlineRisk, reminderPlan, validateDeadlineDates } from "@/lib/deadlines/safety";

export async function confirmDeadline(input: {
  deadlineId: string;
  workspaceId: string;
  confirmedByUserId: string;
  primaryResponsibleUserId: string;
  reviewerUserId?: string | null;
  dueAt: Date;
  internalDueAt?: Date | null;
  ruleSummary?: string | null;
}) {
  validateDeadlineDates(input.dueAt, input.internalDueAt ?? null);

  const [deadline, policy, responsible, reviewer] = await Promise.all([
    prisma.deadline.findFirst({ where: { id: input.deadlineId, workspaceId: input.workspaceId } }),
    prisma.deadlinePolicy.findFirst({ where: { workspaceId: input.workspaceId, isDefault: true } }),
    prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.primaryResponsibleUserId } } }),
    input.reviewerUserId
      ? prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.reviewerUserId } } })
      : Promise.resolve(null),
  ]);
  if (!deadline) throw new Error("Deadline not found");
  if (!responsible || responsible.status !== "ACTIVE") throw new Error("Responsible user is not an active workspace member");
  if (input.reviewerUserId && (!reviewer || reviewer.status !== "ACTIVE")) throw new Error("Reviewer is not an active workspace member");
  if ((policy?.requireReviewer ?? true) && !input.reviewerUserId) throw new Error("This workspace requires a reviewer before confirming a deadline");

  const reminders = reminderPlan(input.dueAt, input.internalDueAt ?? null);

  return prisma.$transaction(async (tx) => {
    await tx.deadlineReminder.deleteMany({ where: { deadlineId: deadline.id, status: "PENDING" } });
    const updated = await tx.deadline.update({
      where: { id: deadline.id },
      data: {
        status: "CONFIRMED",
        risk: deadlineRisk(input.dueAt),
        dueAt: input.dueAt,
        internalDueAt: input.internalDueAt ?? null,
        primaryResponsibleUserId: input.primaryResponsibleUserId,
        reviewerUserId: input.reviewerUserId ?? null,
        confirmedAt: new Date(),
        confirmedByUserId: input.confirmedByUserId,
        ruleSummary: input.ruleSummary ?? deadline.ruleSummary,
      },
    });
    if (reminders.length) {
      await tx.deadlineReminder.createMany({
        data: reminders.flatMap((r) => [
          { deadlineId: deadline.id, scheduledAt: r.at, channel: r.channel, stage: r.stage, recipientUserId: input.primaryResponsibleUserId },
          ...(input.reviewerUserId ? [{ deadlineId: deadline.id, scheduledAt: r.at, channel: r.channel, stage: r.stage, recipientUserId: input.reviewerUserId }] : []),
        ]),
      });
    }
    await tx.activityLog.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.confirmedByUserId,
        type: "DEADLINE_CONFIRMED",
        entityType: "Deadline",
        entityId: deadline.id,
        summary: `Prazo confirmado para ${input.dueAt.toISOString()}`,
        metadata: { primaryResponsibleUserId: input.primaryResponsibleUserId, reviewerUserId: input.reviewerUserId ?? null },
      },
    });
    return updated;
  });
}

export async function completeDeadline(input: { deadlineId: string; workspaceId: string; userId: string }) {
  const deadline = await prisma.deadline.findFirst({ where: { id: input.deadlineId, workspaceId: input.workspaceId } });
  if (!deadline) throw new Error("Deadline not found");
  if (deadline.status === "CANCELLED") throw new Error("Cancelled deadline cannot be completed");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.deadline.update({
      where: { id: deadline.id },
      data: { status: "COMPLETED", risk: "NORMAL", completedAt: new Date(), completedByUserId: input.userId },
    });
    await tx.deadlineReminder.updateMany({ where: { deadlineId: deadline.id, status: "PENDING" }, data: { status: "CANCELLED" } });
    await tx.activityLog.create({
      data: { workspaceId: input.workspaceId, userId: input.userId, type: "DEADLINE_COMPLETED", entityType: "Deadline", entityId: deadline.id, summary: "Prazo concluído" },
    });
    return updated;
  });
}
