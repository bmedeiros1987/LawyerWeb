import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import { allows } from "@/lib/authz/visibility";
import { isDesktop, DesktopError } from "./env";
import { initialState, scopeKey, type Scope, type Store, type SyncState } from "./court-sync";

export async function courtState(scope: Scope): Promise<SyncState> {
  if (!isDesktop()) throw new DesktopError("Not found", 404);
  const rows = await prisma.$queryRaw<Array<{ value: string }>>
    `select value from desktop.local_setting where key = ${scopeKey(scope)}`;
  return rows[0] ? JSON.parse(rows[0].value) : initialState();
}

/** Caller must authorize the selected workspace/matter. Recipients are checked again
 * inside the transaction. No Web Push, provider fetch or deadline operation lives here.
 */
export const courtStore: Store = {
  async transaction(scope, action) {
    if (!isDesktop()) throw new DesktopError("Not found", 404);
    return prisma.$transaction(async tx => {
      const key = scopeKey(scope);
      // Same scope, including concurrent requests: one cursor and one notification owner.
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const rows = await tx.$queryRaw<Array<{ value: string }>>
        `select value from desktop.local_setting where key = ${key}`;
      const state = rows[0] ? JSON.parse(rows[0].value) as SyncState : initialState();
      // Lock prevents a concurrent change to secrecy/workspace/owner during this commit.
      await tx.$queryRaw`select id from public."Matter" where id = ${scope.matterId} and "workspaceId" = ${scope.workspaceId} for update`;
      const matter = await tx.matter.findFirst({ where: { id: scope.matterId, workspaceId: scope.workspaceId } });
      // Scope authorization may have been revoked since the route checked it.
      // Lock and re-read the initiating actor before provider I/O, not only recipients.
      await tx.$queryRaw`select id from public."WorkspaceMember" where "workspaceId" = ${scope.workspaceId}
        and "userId" = ${scope.actorUserId} for share`;
      await tx.$queryRaw`select r.id from public."WorkspaceRole" r join public."WorkspaceMember" m on m."roleId" = r.id
        where m."workspaceId" = ${scope.workspaceId} and m."userId" = ${scope.actorUserId} for share of r`;
      const actor = await tx.workspaceMember.findUnique({ where: {
        workspaceId_userId: { workspaceId: scope.workspaceId, userId: scope.actorUserId },
      }, include: { role: true } });
      return action({
        state,
        async eligible() {
          if (!actor || !allows(actor, "matters.view"))
            throw new DesktopError("Processo não encontrado.", 404);
          return Boolean(matter && !matter.secrecy && matter.status === "ACTIVE" && matter.number);
        },
        async insert(event, identity, capturedAt) {
          const added = await tx.courtCommunication.createMany({ data: [{
            workspaceId: scope.workspaceId, matterId: scope.matterId, source: scope.source,
            externalId: identity, title: event.title, body: event.body,
            type: scope.source === "DATAJUD" ? "PROCESS_MOVEMENT" : "COURT_PUBLICATION",
            requiresAction: false, receivedAt: new Date(capturedAt),
            publishedAt: event.occurredAt && Number.isFinite(Date.parse(event.occurredAt)) ? new Date(event.occurredAt) : null,
            contentHash: createHash("sha256").update(JSON.stringify(event)).digest("hex"),
            payload: JSON.parse(JSON.stringify({ ...event.evidence, provider: scope.source,
              providerEventId: event.id, sourceDateRaw: event.occurredAt, capturedAt,
              deadlineSafety: "NO_AUTOMATIC_DEADLINE" })),
          }], skipDuplicates: true });
          if (!added.count) return { imported: 0, inAppNotified: 0 };
          const communication = await tx.courtCommunication.findUniqueOrThrow({ where: {
            workspaceId_source_externalId: { workspaceId: scope.workspaceId, source: scope.source, externalId: identity },
          }, select: { id: true } });
          const candidates = event.notify === false ? [] :
            [...new Set([matter?.ownerUserId, matter?.responsibleUserId].filter((id): id is string => Boolean(id)))];
          // Access changes cannot race the notification commit.
          await tx.$queryRaw`select m.id from public."WorkspaceMember" m where
            m."workspaceId" = ${scope.workspaceId} and m."userId" = any(${candidates}::text[]) for share`;
          await tx.$queryRaw`select r.id from public."WorkspaceRole" r join public."WorkspaceMember" m on m."roleId" = r.id
            where m."workspaceId" = ${scope.workspaceId} and m."userId" = any(${candidates}::text[]) for share of r`;
          const members = await tx.workspaceMember.findMany({ where: {
            workspaceId: scope.workspaceId, userId: { in: candidates }, status: "ACTIVE",
          }, include: { role: true } });
          const recipients = members.filter(m => allows(m, "matters.view"));
          if (recipients.length) await tx.userNotification.createMany({ data: recipients.map(m => ({
            workspaceId: scope.workspaceId, userId: m.userId, type: "COURT_UPDATE", severity: "INFO",
            title: "Nova comunicação de tribunal", body: "Abra a Caixa Jurídica para revisar. Nenhum prazo foi criado automaticamente.",
            entityType: "CourtCommunication", entityId: communication.id,
          })) });
          return { imported: 1, inAppNotified: recipients.length };
        },
        async save(next) {
          await tx.$executeRaw`insert into desktop.local_setting (key, value) values (${key}, ${JSON.stringify(next)})
            on conflict (key) do update set value = excluded.value, updated_at = now()`;
        },
      });
    }, { timeout: 30_000 });
  },
};
