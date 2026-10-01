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

/**
 * Web Push outcome for one or more recipients.
 * `accepted` means the browser push service (FCM/APNs/Mozilla) accepted the message. It is NOT a delivery receipt:
 * only the device can prove it displayed the notification (see docs/COURT-PUSH.md, "Prova de entrega").
 */
export type PushDelivery = {
  /** Users for whom a push was considered (they received an in-app notification). */
  recipients: number;
  /** Not attempted: VAPID is not configured in this environment. */
  skippedNoVapid: number;
  /** Not attempted: the user has no registered device subscription. */
  skippedNoSubscription: number;
  /** Device subscriptions a push was attempted for. */
  subscriptions: number;
  /** Accepted by the push service (HTTP 2xx). Not proof of delivery. */
  accepted: number;
  /** Rejected by the push service or failed in transit. */
  failed: number;
  /** Expired subscriptions (404/410) removed. */
  removed: number;
};

export const emptyPushDelivery = (): PushDelivery => ({
  recipients: 0, skippedNoVapid: 0, skippedNoSubscription: 0, subscriptions: 0, accepted: 0, failed: 0, removed: 0,
});

export function addPushDelivery(a: PushDelivery, b: PushDelivery): PushDelivery {
  return {
    recipients: a.recipients + b.recipients,
    skippedNoVapid: a.skippedNoVapid + b.skippedNoVapid,
    skippedNoSubscription: a.skippedNoSubscription + b.skippedNoSubscription,
    subscriptions: a.subscriptions + b.subscriptions,
    accepted: a.accepted + b.accepted,
    failed: a.failed + b.failed,
    removed: a.removed + b.removed,
  };
}

export const PUSH_DELIVERY_NOTE =
  "push.accepted = accepted by the browser push service; device delivery is not confirmed by the server. inAppNotified = in-app notifications created (always persisted).";

export type CourtPushResult = {
  matterId: string;
  imported: number;
  /** In-app (UserNotification) notifications persisted. Says nothing about Web Push delivery. */
  inAppNotified: number;
  push: PushDelivery;
  skipped?: string;
  truncated?: boolean;
};

const skippedResult = (matterId: string, skipped: string, truncated?: boolean): CourtPushResult => ({
  matterId, imported: 0, inAppNotified: 0, push: emptyPushDelivery(), skipped, ...(truncated === undefined ? {} : { truncated }),
});

const COPY = {
  publication: {
    title: "Nova publicação oficial no DJEN",
    body: "Abra a Caixa Jurídica para revisar a publicação. Nenhum prazo foi criado automaticamente.",
  },
  movement: {
    title: "Nova movimentação de tribunal",
    body: "Abra a Caixa Jurídica para revisar a atualização. Nenhum prazo foi criado automaticamente.",
  },
} as const;

type Kind = keyof typeof COPY;

/**
 * Users who may be told about this matter: owner and responsible who still have matters.view and, for secret
 * matters, explicit access. A user who lost membership/permission is simply not a recipient (canAccessMatter
 * throws 403 for them) and must never block the others.
 */
async function authorizedRecipients(matter: CourtPushMatter) {
  const candidates = [...new Set([matter.ownerUserId, matter.responsibleUserId].filter((value): value is string => Boolean(value)))];
  const allowed: string[] = [];
  for (const userId of candidates) {
    try {
      if (await canAccessMatter(userId, matter.workspaceId, matter.id, P.MATTERS_VIEW)) allowed.push(userId);
    } catch (error) {
      if ((error as { status?: number })?.status !== 403) throw error;
    }
  }
  return allowed;
}

/**
 * Persist one court communication and, in the SAME transaction, the in-app notifications for authorized users.
 * If anything fails the whole thing rolls back, so the next poll sees the item as new and retries (at-least-once).
 * Web Push is sent after commit, is best-effort, and its outcome is reported but never undoes the ingestion.
 */
async function recordCommunication(
  matter: CourtPushMatter,
  source: "DATAJUD" | "DJEN",
  data: Omit<Prisma.CourtCommunicationUncheckedCreateInput, "workspaceId" | "matterId" | "source">,
  notify: Kind | null,
  recipientsOnce: () => Promise<string[]>,
): Promise<{ imported: boolean; inAppNotified: number; push: PushDelivery }> {
  const none = { imported: false, inAppNotified: 0, push: emptyPushDelivery() };
  const externalId = data.externalId as string;
  const key = { workspaceId_source_externalId: { workspaceId: matter.workspaceId, source, externalId } };
  if (await prisma.courtCommunication.findUnique({ where: key, select: { id: true } })) return none; // cheap duplicate fast-path

  const recipients = notify ? await recipientsOnce() : [];
  const committed = await prisma.$transaction(async tx => {
    const create = await tx.courtCommunication.createMany({
      data: [{ ...data, workspaceId: matter.workspaceId, matterId: matter.id, source }],
      skipDuplicates: true,
    });
    if (create.count === 0) return null; // lost a race with a concurrent poll: that poll owns the notification
    const communication = await tx.courtCommunication.findUniqueOrThrow({ where: key, select: { id: true } });
    if (notify && recipients.length > 0) {
      await tx.userNotification.createMany({
        data: recipients.map(userId => ({
          workspaceId: matter.workspaceId,
          userId,
          type: "COURT_UPDATE",
          severity: "INFO",
          title: COPY[notify].title,
          body: COPY[notify].body,
          entityType: "CourtCommunication",
          entityId: communication.id,
        })),
      });
    }
    return communication.id;
  });
  if (committed === null) return none;

  const push = emptyPushDelivery();
  if (notify) {
    for (const userId of recipients) {
      push.recipients += 1;
      try {
        const sent = await sendPushToUser(userId, {
          title: COPY[notify].title,
          body: "Abra a Caixa Jurídica para revisar a atualização.",
          url: "/app/inbox",
          tag: `court-update-${committed}`,
        });
        if (sent.skipped) {
          if (sent.reason === "VAPID_NOT_CONFIGURED") push.skippedNoVapid += 1; else push.skippedNoSubscription += 1;
        } else {
          push.subscriptions += sent.attempted;
          push.accepted += sent.sent;
          push.failed += sent.failed;
          push.removed += sent.removed;
        }
      } catch {
        push.failed += 1; // the push layer must never undo or fail the ingestion
      }
    }
  }
  return { imported: true, inAppNotified: recipients.length, push };
}

const once = <T,>(factory: () => Promise<T>) => {
  let value: Promise<T> | undefined;
  return () => (value ??= factory());
};

function movementTime(movement: { dataHora?: string | null }) {
  const parsed = movement.dataHora ? Date.parse(movement.dataHora) : NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

/** Newest movement timestamp already stored for this matter (from the preserved evidence), or null if unknown. */
async function newestStoredMovementTime(matter: CourtPushMatter) {
  const rows = await prisma.courtCommunication.findMany({
    where: { workspaceId: matter.workspaceId, matterId: matter.id, source: "DATAJUD" },
    select: { payload: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  let newest: number | null = null;
  for (const row of rows) {
    const payload = row.payload as { movement?: { dataHora?: string | null } } | null;
    const time = payload?.movement ? movementTime(payload.movement) : null;
    if (time !== null && (newest === null || time > newest)) newest = time;
  }
  return newest;
}

export async function syncMatterFromDataJud(matter: CourtPushMatter): Promise<CourtPushResult> {
  if (matter.secrecy) return skippedResult(matter.id, "secret-matter");
  if (!matter.number) return skippedResult(matter.id, "missing-number");

  const lookup = await fetchDataJudProcess(matter.number, matter.court);
  if (!lookup.process) return skippedResult(matter.id, "not-found");

  const movements = orderedDataJudMovements(lookup.process.movimentos);
  if (movements.length === 0) return skippedResult(matter.id, "no-movements");

  const hasBaseline = await prisma.courtCommunication.count({
    where: { workspaceId: matter.workspaceId, matterId: matter.id, source: "DATAJUD" },
  }) > 0;

  // Bootstrap: only the latest known movement, to avoid flooding the legal inbox with history.
  // Later polls: only movements at or after the newest one we already hold. Older history is never back-filled
  // (and therefore never announced); movements sharing the newest timestamp are kept so none is lost.
  let candidates = movements.slice(-1);
  if (hasBaseline) {
    const baseline = await newestStoredMovementTime(matter);
    if (baseline !== null) {
      candidates = movements.filter(movement => {
        const time = movementTime(movement);
        return time !== null && time >= baseline;
      }).slice(-50);
    }
  }

  const recipientsOnce = once(() => authorizedRecipients(matter));
  let imported = 0;
  let inAppNotified = 0;
  let push = emptyPushDelivery();

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
    const outcome = await recordCommunication(matter, "DATAJUD", {
      externalId,
      type: "PROCESS_MOVEMENT",
      title: movement.nome?.trim() || (movement.codigo != null ? `Movimentação TPU ${movement.codigo}` : "Movimentação processual"),
      body: dataJudMovementBody(movement),
      contentHash,
      status: "NEW",
      requiresAction: false,
      payload: evidence,
    }, "movement", recipientsOnce);
    if (!outcome.imported) continue;
    imported += 1;
    inAppNotified += outcome.inAppNotified;
    push = addPushDelivery(push, outcome.push);
  }

  return { matterId: matter.id, imported, inAppNotified, push };
}

function publicationTime(publication: DjenPublication) {
  return djenPublicationDate(publication)?.getTime() ?? 0;
}

export async function syncMatterFromDjen(matter: CourtPushMatter): Promise<CourtPushResult> {
  if (matter.secrecy) return skippedResult(matter.id, "secret-matter");
  if (!matter.number) return skippedResult(matter.id, "missing-number");

  const lookup = await fetchDjenPublications(matter.number);
  const publications = lookup.publications.slice().sort((a, b) => publicationTime(a) - publicationTime(b));
  if (publications.length === 0) return skippedResult(matter.id, "no-publications", lookup.truncated);

  const hasBaseline = await prisma.courtCommunication.count({
    where: { workspaceId: matter.workspaceId, matterId: matter.id, source: "DJEN" },
  }) > 0;
  const newestIndex = publications.length - 1;
  const recipientsOnce = once(() => authorizedRecipients(matter));
  let imported = 0;
  let inAppNotified = 0;
  let push = emptyPushDelivery();

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

    // On first activation preserve all recent evidence but notify only the newest item.
    // Subsequent polls notify every genuinely new publication.
    const notify: Kind | null = hasBaseline || index === newestIndex ? "publication" : null;
    const outcome = await recordCommunication(matter, "DJEN", {
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
    }, notify, recipientsOnce);
    if (!outcome.imported) continue;
    imported += 1;
    inAppNotified += outcome.inAppNotified;
    push = addPushDelivery(push, outcome.push);
  }

  return { matterId: matter.id, imported, inAppNotified, push, truncated: lookup.truncated };
}
