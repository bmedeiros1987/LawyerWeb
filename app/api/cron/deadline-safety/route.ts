import { canReceiveDeadline } from "@/lib/deadlines/service";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deadlineRisk } from "@/lib/deadlines/safety";
import { sendPushToUser } from "@/lib/push/webpush";

export async function POST(request: NextRequest) {
  const secret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const deadlines = await prisma.deadline.findMany({
    where: { status: { in: ["CONFIRMED", "IN_PROGRESS"] }, dueAt: { not: null } },
    select: { id: true, workspaceId: true, title: true, dueAt: true, risk: true, primaryResponsibleUserId: true, reviewerUserId: true },
    take: 5000,
  });

  let riskUpdates = 0;
  for (const d of deadlines) {
    const risk = deadlineRisk(d.dueAt);
    if (risk !== d.risk) {
      await prisma.deadline.update({ where: { id: d.id }, data: { risk } });
      riskUpdates += 1;
    }
  }

  const reminders = await prisma.deadlineReminder.findMany({
    where: { status: "PENDING", scheduledAt: { lte: now }, deadline: { status: { in: ["CONFIRMED", "IN_PROGRESS"] } } },
    include: { deadline: { select: { workspaceId: true, title: true, dueAt: true, primaryResponsibleUserId: true, reviewerUserId: true } } },
    take: 2000,
    orderBy: { scheduledAt: "asc" },
  });

  let notifications = 0;
  for (const r of reminders) {
    await prisma.$transaction(async (tx) => {
      if (r.recipientUserId && await canReceiveDeadline(r.recipientUserId,r.deadline.workspaceId,r.deadlineId)) {
        await tx.userNotification.create({
          data: {
            workspaceId: r.deadline.workspaceId,
            userId: r.recipientUserId,
            type: r.channel === "ESCALATION" ? "DEADLINE_ESCALATION" : "DEADLINE_REMINDER",
            severity: r.stage >= 4 ? "CRITICAL" : r.stage >= 3 ? "HIGH" : "INFO",
            title: r.stage >= 4 ? "Prazo exige ação no MBLZ" : "Lembrete de prazo no MBLZ",
            body: "Abra o MBLZ para consultar os detalhes autorizados.",
            entityType: "Deadline",
            entityId: r.deadlineId,
          },
        });
        notifications += 1;
        if (r.channel === "PUSH" || r.channel === "ESCALATION") {
          await sendPushToUser(r.recipientUserId, {
            title: r.stage >= 4 ? "Prazo exige ação no MBLZ" : "Lembrete de prazo no MBLZ",
            body: "Abra o MBLZ para consultar os detalhes autorizados.",
            url: "/app/prazos",
            tag: `deadline-${r.deadlineId}`,
          });
        }
      }
      if (r.channel === "ESCALATION") {
        const managers = await tx.workspaceMember.findMany({
          where: { workspaceId: r.deadline.workspaceId, status: "ACTIVE", role: { level: { gte: 90 } } },
          select: { userId: true },
        });
        for (const m of managers) {
          if (m.userId === r.recipientUserId) continue;
          if (!await canReceiveDeadline(m.userId,r.deadline.workspaceId,r.deadlineId)) continue;
          await tx.userNotification.create({
            data: {
              workspaceId: r.deadline.workspaceId,
              userId: m.userId,
              type: "DEADLINE_ESCALATION",
              severity: "CRITICAL",
              title: "Escalonamento de prazo no MBLZ",
              body: "Prazo próximo do limite e requer acompanhamento da coordenação.",
              entityType: "Deadline",
              entityId: r.deadlineId,
            },
          });
          notifications += 1;
          await sendPushToUser(m.userId, {
            title: "Escalonamento de prazo no MBLZ",
            body: "Prazo próximo do limite e requer acompanhamento da coordenação.",
            url: "/app/prazos",
            tag: `deadline-escalation-${r.deadlineId}`,
          });
        }
      }
      await tx.deadlineReminder.update({ where: { id: r.id }, data: { status: "SENT", sentAt: now } });
    });
  }

  return NextResponse.json({ ok: true, scanned: deadlines.length, riskUpdates, reminders: reminders.length, notifications });
}
