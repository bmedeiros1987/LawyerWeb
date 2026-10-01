import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canAccessMatter, P } from "@/lib/authz/permissions";
import { sendPushToUser } from "@/lib/push/webpush";
import {
  dataJudMovementBody,
  dataJudMovementIdentity,
  fetchDataJudProcess,
  orderedDataJudMovements,
} from "@/lib/courts/datajud";

export type CourtPushMatter = {
  id: string;
  workspaceId: string;
  number: string | null;
  court: string | null;
  secrecy: boolean;
  ownerUserId: string | null;
  responsibleUserId: string | null;
};

export type CourtPushResult = {
  matterId: string;
  imported: number;
  notified: number;
  skipped?: string;
};

async function notifyMatterUsers(matter: CourtPushMatter, communicationId: string) {
  const recipients = [...new Set([matter.ownerUserId, matter.responsibleUserId].filter((value): value is string => Boolean(value)))];
  let notified = 0;

  for (const userId of recipients) {
    if (!await canAccessMatter(userId, matter.workspaceId, matter.id, P.MATTERS_VIEW)) continue;
    await prisma.userNotification.create({
      data: {
        workspaceId: matter.workspaceId,
        userId,
        type: "COURT_UPDATE",
        severity: "INFO",
        title: "Nova movimentação de tribunal",
        body: "Abra a Caixa Jurídica para revisar a atualização. Nenhum prazo foi criado automaticamente.",
        entityType: "CourtCommunication",
        entityId: communicationId,
      },
    });
    await sendPushToUser(userId, {
      title: "Nova movimentação de tribunal",
      body: "Abra a Caixa Jurídica para revisar a atualização.",
      url: "/app/inbox",
      tag: `court-update-${communicationId}`,
    });
    notified += 1;
  }

  return notified;
}

export async function syncMatterFromDataJud(matter: CourtPushMatter): Promise<CourtPushResult> {
  if (matter.secrecy) return { matterId: matter.id, imported: 0, notified: 0, skipped: "secret-matter" };
  if (!matter.number) return { matterId: matter.id, imported: 0, notified: 0, skipped: "missing-number" };

  const lookup = await fetchDataJudProcess(matter.number, matter.court);
  if (!lookup.process) return { matterId: matter.id, imported: 0, notified: 0, skipped: "not-found" };

  const movements = orderedDataJudMovements(lookup.process.movimentos);
  if (movements.length === 0) return { matterId: matter.id, imported: 0, notified: 0, skipped: "no-movements" };

  const hasBaseline = await prisma.courtCommunication.count({
    where: { workspaceId: matter.workspaceId, matterId: matter.id, source: "DATAJUD" },
  }) > 0;

  // Bootstrap with only the latest known movement to avoid flooding the legal inbox
  // with historical events. Later runs inspect the newest 50 for changes between polls.
  const candidates = hasBaseline ? movements.slice(-50) : movements.slice(-1);
  let imported = 0;
  let notified = 0;

  for (const movement of candidates) {
    const { externalId, contentHash } = dataJudMovementIdentity(lookup.process.id, movement);
    const evidence = JSON.parse(JSON.stringify({
      provider: "CNJ_DATAJUD_PUBLIC",
      alias: lookup.alias,
      datajudProcessId: lookup.process.id,
      tribunal: lookup.process.tribunal ?? null,
      numeroProcesso: lookup.process.numeroProcesso ?? matter.number,
      dataHoraUltimaAtualizacao: lookup.process.dataHoraUltimaAtualizacao ?? null,
      movement,
      deadlineSafety: "NO_AUTOMATIC_DEADLINE",
    })) as Prisma.InputJsonValue;
    const create = await prisma.courtCommunication.createMany({
      data: [{
        workspaceId: matter.workspaceId,
        matterId: matter.id,
        source: "DATAJUD",
        externalId,
        type: "PROCESS_MOVEMENT",
        title: movement.nome?.trim() || (movement.codigo != null ? `Movimentação TPU ${movement.codigo}` : "Movimentação processual"),
        body: dataJudMovementBody(movement),
        contentHash,
        status: "NEW",
        requiresAction: false,
        payload: evidence,
      }],
      skipDuplicates: true,
    });
    if (create.count === 0) continue;

    imported += 1;
    const communication = await prisma.courtCommunication.findUniqueOrThrow({
      where: {
        workspaceId_source_externalId: {
          workspaceId: matter.workspaceId,
          source: "DATAJUD",
          externalId,
        },
      },
      select: { id: true },
    });
    notified += await notifyMatterUsers(matter, communication.id);
  }

  return { matterId: matter.id, imported, notified };
}
