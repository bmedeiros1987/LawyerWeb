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
import {
  djenOfficialUrl,
  djenPublicationBody,
  djenPublicationDate,
  djenPublicationIdentity,
  fetchDjenPublications,
  type DjenPublication,
} from "@/lib/courts/djen";

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
  truncated?: boolean;
};

async function notifyMatterUsers(
  matter: CourtPushMatter,
  communicationId: string,
  kind: "movement" | "publication",
) {
  const recipients = [...new Set([matter.ownerUserId, matter.responsibleUserId].filter((value): value is string => Boolean(value)))];
  const title = kind === "publication" ? "Nova publicação oficial no DJEN" : "Nova movimentação de tribunal";
  const body = kind === "publication"
    ? "Abra a Caixa Jurídica para revisar a publicação. Nenhum prazo foi criado automaticamente."
    : "Abra a Caixa Jurídica para revisar a atualização. Nenhum prazo foi criado automaticamente.";
  let notified = 0;

  for (const userId of recipients) {
    if (!await canAccessMatter(userId, matter.workspaceId, matter.id, P.MATTERS_VIEW)) continue;
    await prisma.userNotification.create({
      data: {
        workspaceId: matter.workspaceId,
        userId,
        type: "COURT_UPDATE",
        severity: "INFO",
        title,
        body,
        entityType: "CourtCommunication",
        entityId: communicationId,
      },
    });
    await sendPushToUser(userId, {
      title,
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
    notified += await notifyMatterUsers(matter, communication.id, "movement");
  }

  return { matterId: matter.id, imported, notified };
}

function publicationTime(publication: DjenPublication) {
  return djenPublicationDate(publication)?.getTime() ?? 0;
}

export async function syncMatterFromDjen(matter: CourtPushMatter): Promise<CourtPushResult> {
  if (matter.secrecy) return { matterId: matter.id, imported: 0, notified: 0, skipped: "secret-matter" };
  if (!matter.number) return { matterId: matter.id, imported: 0, notified: 0, skipped: "missing-number" };

  const lookup = await fetchDjenPublications(matter.number);
  const publications = lookup.publications.slice().sort((a, b) => publicationTime(a) - publicationTime(b));
  if (publications.length === 0) {
    return { matterId: matter.id, imported: 0, notified: 0, skipped: "no-publications", truncated: lookup.truncated };
  }

  const hasBaseline = await prisma.courtCommunication.count({
    where: { workspaceId: matter.workspaceId, matterId: matter.id, source: "DJEN" },
  }) > 0;
  const newestIndex = publications.length - 1;
  let imported = 0;
  let notified = 0;

  for (const [index, publication] of publications.entries()) {
    const { externalId, contentHash } = djenPublicationIdentity(publication);
    const publishedAt = djenPublicationDate(publication);
    const evidence = JSON.parse(JSON.stringify({
      provider: "CNJ_DJEN_PUBLIC",
      queryWindow: lookup.window,
      publication,
      deadlineSafety: "NO_AUTOMATIC_DEADLINE",
      requiresHumanReview: true,
    })) as Prisma.InputJsonValue;

    const create = await prisma.courtCommunication.createMany({
      data: [{
        workspaceId: matter.workspaceId,
        matterId: matter.id,
        source: "DJEN",
        externalId,
        type: "COURT_PUBLICATION",
        title: publication.tipoComunicacao?.trim()
          ? `DJEN · ${publication.tipoComunicacao.trim()}`
          : "DJEN · Publicação oficial",
        body: djenPublicationBody(publication),
        publishedAt,
        availableAt: publishedAt,
        officialUrl: djenOfficialUrl(publication),
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
          source: "DJEN",
          externalId,
        },
      },
      select: { id: true },
    });

    // On first activation preserve all recent evidence but notify only the newest item.
    // Subsequent polls notify every genuinely new publication.
    if (hasBaseline || index === newestIndex) {
      notified += await notifyMatterUsers(matter, communication.id, "publication");
    }
  }

  return { matterId: matter.id, imported, notified, truncated: lookup.truncated };
}
