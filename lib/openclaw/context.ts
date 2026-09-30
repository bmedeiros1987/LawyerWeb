import { prisma } from "@/lib/prisma";
import { contractScope, deadlineScope, inboxScope, matterScope, taskScope, type Viewer } from "@/lib/authz/visibility";

export async function buildAgentContext(viewer: Viewer) {
  const now = new Date();
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [deadlines, tasks, matters, contracts, demands, communications] = await Promise.all([
    prisma.deadline.findMany({
      where: {
        ...deadlineScope(viewer),
        status: { in: ["CONFIRMED", "IN_PROGRESS"] },
        dueAt: { gte: now, lte: horizon },
      },
      include: { matter: { select: { id: true, number: true, title: true } } },
      orderBy: [{ risk: "desc" }, { dueAt: "asc" }],
      take: 8,
    }),
    prisma.legalTask.findMany({
      where: {
        ...taskScope(viewer),
        status: { notIn: ["DONE", "CANCELLED"] },
        OR: [
          { assigneeUserId: viewer.userId },
          { requesterUserId: viewer.userId },
          { reviewerUserId: viewer.userId },
        ],
      },
      include: { matter: { select: { id: true, number: true, title: true } } },
      orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
      take: 8,
    }),
    prisma.matter.findMany({
      where: matterScope(viewer),
      select: { id: true, number: true, internalCode: true, title: true, phase: true, status: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
    prisma.contract.findMany({
      where: { ...contractScope(viewer), status: { in: ["REVIEW", "SIGNING", "ACTIVE", "EXPIRING"] } },
      select: { id: true, title: true, status: true, expiresAt: true, counterparty: true },
      orderBy: [{ expiresAt: "asc" }, { updatedAt: "desc" }],
      take: 5,
    }),
    prisma.intakeDemand.findMany({
      where: { ...inboxScope(viewer), status: { in: ["NEW", "REVIEWING"] } },
      select: { id: true, source: true, title: true, bodyPreview: true, actionCandidate: true, dueCandidate: true, receivedAt: true },
      orderBy: { receivedAt: "desc" },
      take: 5,
    }),
    prisma.courtCommunication.findMany({
      where: { ...inboxScope(viewer), status: "NEW" },
      select: { id: true, source: true, title: true, body: true, receivedAt: true, publishedAt: true },
      orderBy: { receivedAt: "desc" },
      take: 5,
    }),
  ]);

  return {
    generatedAt: now.toISOString(),
    rules: {
      trustedSource: "MBLZ",
      legalDeadlineConfirmation: "HUMAN_ONLY",
      externalSend: "HUMAN_APPROVAL_REQUIRED",
      destructiveActions: "DENIED",
    },
    deadlines: deadlines.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      risk: d.risk,
      dueAt: d.dueAt?.toISOString() ?? null,
      internalDueAt: d.internalDueAt?.toISOString() ?? null,
      matter: d.matter ? { id: d.matter.id, number: d.matter.number, title: d.matter.title } : null,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt?.toISOString() ?? null,
      matter: t.matter ? { id: t.matter.id, number: t.matter.number, title: t.matter.title } : null,
    })),
    matters,
    contracts: contracts.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      expiresAt: c.expiresAt?.toISOString() ?? null,
      counterparty: c.counterparty,
    })),
    legalInbox: {
      demands: demands.map((d) => ({
        id: d.id,
        source: d.source,
        title: d.title,
        preview: (d.actionCandidate ?? d.bodyPreview ?? "").slice(0, 1200),
        dueCandidate: d.dueCandidate?.toISOString() ?? null,
        receivedAt: d.receivedAt.toISOString(),
      })),
      courtCommunications: communications.map((c) => ({
        id: c.id,
        source: c.source,
        title: c.title ?? "Comunicação processual",
        preview: (c.body ?? "").slice(0, 1200),
        receivedAt: c.receivedAt.toISOString(),
        publishedAt: c.publishedAt?.toISOString() ?? null,
      })),
    },
  };
}
