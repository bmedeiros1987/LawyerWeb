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

/** Persist evidence and its in-app notification in the caller's transaction. */
async function persistCommunication(
  tx: Prisma.TransactionClient,
  matter: CourtPushMatter,
  source: "DATAJUD" | "DJEN",
  data: Omit<Prisma.CourtCommunicationUncheckedCreateInput, "workspaceId" | "matterId" | "source">,
  notify: Kind | null,
  recipients: string[],
): Promise<string | null> {
  const key = { workspaceId_source_externalId: { workspaceId: matter.workspaceId, source, externalId: data.externalId as string } };
  const create = await tx.courtCommunication.createMany({
    data: [{ ...data, workspaceId: matter.workspaceId, matterId: matter.id, source }], skipDuplicates: true,
  });
  if (create.count === 0) return null;
  const communication = await tx.courtCommunication.findUniqueOrThrow({ where: key, select: { id: true } });
  if (notify && recipients.length > 0) {
    await tx.userNotification.createMany({ data: recipients.map(userId => ({
      workspaceId: matter.workspaceId, userId, type: "COURT_UPDATE", severity: "INFO",
      title: COPY[notify].title, body: COPY[notify].body, entityType: "CourtCommunication", entityId: communication.id,
    })) });
  }
  return communication.id;
}

/** Web Push is best-effort, after commit, and never undoes persisted evidence. */
async function deliverPush(communicationId: string, notify: Kind | null, recipients: string[]) {
  const push = emptyPushDelivery();
  if (!notify) return push;
  for (const userId of recipients) {
    push.recipients += 1;
    try {
      const sent = await sendPushToUser(userId, {
        title: COPY[notify].title, body: "Abra a Caixa Jurídica para revisar a atualização.",
        url: "/app/inbox", tag: `court-update-${communicationId}`,
      });
      if (sent.skipped) {
        if (sent.reason === "VAPID_NOT_CONFIGURED") push.skippedNoVapid += 1; else push.skippedNoSubscription += 1;
      } else {
        push.subscriptions += sent.attempted; push.accepted += sent.sent;
        push.failed += sent.failed; push.removed += sent.removed;
      }
    } catch { push.failed += 1; }
  }
  return push;
}

async function recordCommunication(
  matter: CourtPushMatter,
  source: "DATAJUD" | "DJEN",
  data: Omit<Prisma.CourtCommunicationUncheckedCreateInput, "workspaceId" | "matterId" | "source">,
  notify: Kind | null,
  recipientsOnce: () => Promise<string[]>,
): Promise<{ imported: boolean; inAppNotified: number; push: PushDelivery }> {
  const none = { imported: false, inAppNotified: 0, push: emptyPushDelivery() };
  const key = { workspaceId_source_externalId: { workspaceId: matter.workspaceId, source, externalId: data.externalId as string } };
  if (await prisma.courtCommunication.findUnique({ where: key, select: { id: true } })) return none;
  const recipients = notify ? await recipientsOnce() : [];
  const committed = await prisma.$transaction(tx => persistCommunication(tx, matter, source, data, notify, recipients));
  if (committed === null) return none;
  return { imported: true, inAppNotified: recipients.length, push: await deliverPush(committed, notify, recipients) };
}

const once = <T,>(factory: () => Promise<T>) => {
  let value: Promise<T> | undefined;
  return () => (value ??= factory());
};

type DataJudObservation = { version: 1; initialHistoryIds: string[]; quietRecoveryIds: string[] };

function payloadObject(payload: Prisma.JsonValue | null): Prisma.JsonObject {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
}
function observationFrom(payload: Prisma.JsonValue | null): DataJudObservation | null {
  const value = payloadObject(payload).datajudObservation;
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1) return null;
  if (!Array.isArray(value.initialHistoryIds) || !value.initialHistoryIds.every(id => typeof id === "string")
      || !Array.isArray(value.quietRecoveryIds) || !value.quietRecoveryIds.every(id => typeof id === "string")) return null;
  return { version: 1, initialHistoryIds: value.initialHistoryIds as string[], quietRecoveryIds: value.quietRecoveryIds as string[] };
}

export async function syncMatterFromDataJud(matter: CourtPushMatter): Promise<CourtPushResult> {
  if (matter.secrecy) return skippedResult(matter.id, "secret-matter");
  if (!matter.number) return skippedResult(matter.id, "missing-number");
  const lookup = await fetchDataJudProcess(matter.number, matter.court);
  if (!lookup.process) return skippedResult(matter.id, "not-found");
  const process = lookup.process;
  const movements = orderedDataJudMovements(process.movimentos);
  if (movements.length === 0) return skippedResult(matter.id, "no-movements");
  const observed = [...new Map(movements.map(movement => {
    const identity = dataJudMovementIdentity(process.id, movement);
    return [identity.externalId, { movement, ...identity }] as const;
  })).values()];
  const recipientsOnce = once(() => authorizedRecipients(matter));

  const batch = await prisma.$transaction(async tx => {
    // Serialize baseline selection and writes for this tenant/matter, including
    // overlapping first polls. Hash collisions only serialize unrelated scopes.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${JSON.stringify([matter.workspaceId, matter.id, "DATAJUD"])}))`;
    const rows = await tx.courtCommunication.findMany({
      where: { workspaceId: matter.workspaceId, matterId: matter.id, source: "DATAJUD" },
      select: { id: true, externalId: true, payload: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const known = new Set(rows.map(row => row.externalId));
    const bootstrap = rows.length === 0;
    let observation = rows.map(row => observationFrom(row.payload)).find(value => value !== null) ?? null;
    if (!observation) {
      observation = {
        version: 1,
        initialHistoryIds: bootstrap ? observed.slice(0, -1).map(item => item.externalId) : [],
        // Older versions never saved the initial observation. Preserve unknown
        // evidence quietly instead of guessing history from occurrence times.
        quietRecoveryIds: bootstrap ? [] : observed.filter(item => !known.has(item.externalId)).map(item => item.externalId),
      };
      if (!bootstrap) {
        const updated = await tx.courtCommunication.updateMany({
          where: { id: rows[0].id, workspaceId: matter.workspaceId, matterId: matter.id, source: "DATAJUD" },
          data: { payload: { ...payloadObject(rows[0].payload), datajudObservation: observation } as Prisma.InputJsonValue },
        });
        if (updated.count !== 1) throw new Error("DataJud observation anchor changed; retry the poll.");
      }
    }
    const history = new Set(observation.initialHistoryIds);
    const quiet = new Set(observation.quietRecoveryIds);
    // Identity determines novelty; occurrence dates only order the work. Filter
    // persisted identities BEFORE taking 50, so repeated polls drain the backlog.
    const pending = observed.filter(item => !known.has(item.externalId) && !history.has(item.externalId));
    const committed: { id: string; notify: Kind | null; recipients: string[] }[] = [];
    for (const item of pending.slice(0, 50)) {
      const { movement, externalId, contentHash } = item;
      const notify = quiet.has(externalId) ? null : "movement";
      const recipients = notify ? await recipientsOnce() : [];
      const evidence = JSON.parse(JSON.stringify({
        provider: "CNJ_DATAJUD_PUBLIC", alias: lookup.alias, datajudProcessId: process.id,
        tribunal: process.tribunal ?? null, numeroProcesso: process.numeroProcesso ?? matter.number,
        dataHoraUltimaAtualizacao: process.dataHoraUltimaAtualizacao ?? null, movement,
        deadlineSafety: "NO_AUTOMATIC_DEADLINE",
        ...(bootstrap ? { datajudObservation: observation } : {}),
      })) as Prisma.InputJsonValue;
      const id = await persistCommunication(tx, matter, "DATAJUD", {
        externalId, contentHash, type: "PROCESS_MOVEMENT",
        title: movement.nome?.trim() || (movement.codigo != null ? `Movimentação TPU ${movement.codigo}` : "Movimentação processual"),
        body: dataJudMovementBody(movement), status: "NEW", requiresAction: false, payload: evidence,
      }, notify, recipients);
      if (id !== null) committed.push({ id, notify, recipients });
    }
    return { committed, truncated: pending.length > 50 };
  });

  let push = emptyPushDelivery();
  for (const item of batch.committed) push = addPushDelivery(push, await deliverPush(item.id, item.notify, item.recipients));
  return { matterId: matter.id, imported: batch.committed.length,
    inAppNotified: batch.committed.reduce((sum, item) => sum + item.recipients.length, 0), push, truncated: batch.truncated };
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
