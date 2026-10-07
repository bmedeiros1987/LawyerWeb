import { createHash } from "node:crypto";

export type Source = "DATAJUD" | "DJEN";
export type Scope = { workspaceId: string; matterId: string; source: Source; actorUserId: string };
export type SyncState = {
  lastAttempt: string | null; lastSuccess: string | null; cursor: string | null;
  status: "never" | "success" | "partial" | "unavailable";
  reason: string | null;
  /** Durable progress in a bounded batch; never a complete-success cursor. */
  resumeCursor?: string | null;
};
export type CourtEvent = {
  id: string; title: string; body: string; occurredAt: string | null;
  notify?: boolean;
  evidence: Record<string, unknown>;
};
export type Page = {
  events: CourtEvent[]; cursor: string | null; complete: boolean;
  /** Provider checkpoint covering only the identities committed in this batch. */
  checkpointCursor?: string;
};
export type Provider = { source: Source; read(cursor: string | null): Promise<Page> };
export type Transaction = {
  state: SyncState;
  eligible(): Promise<boolean>;
  insert(event: CourtEvent, identity: string, capturedAt: string): Promise<{ imported: number; inAppNotified: number }>;
  save(state: SyncState): Promise<void>;
};
export type Store = { transaction<T>(scope: Scope, action: (tx: Transaction) => Promise<T>): Promise<T> };
export const initialState = (): SyncState => ({
  lastAttempt: null, lastSuccess: null, cursor: null, status: "never", reason: null,
});
export const scopeKey = (scope: Scope) => "court-sync:" + createHash("sha256")
  .update(JSON.stringify([scope.workspaceId, scope.matterId, scope.source])).digest("hex");
export const eventIdentity = (scope: Scope, id: string) => "desktop-court:" + createHash("sha256")
  .update(JSON.stringify([scope.workspaceId, scope.matterId, scope.source, id])).digest("hex");

export class ProviderUnavailable extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

/** Manual-only. No timers, credential fallback, push sender or legal deadline writes.
 * Store must serialize each scope and atomically commit events, internal notices and cursor.
 * Identity, rather than event date, handles late and same-time arrivals.
 */
export async function syncCourt(scope: Scope, provider: Provider, store: Store, now = () => new Date()) {
  if (scope.source !== provider.source) throw new Error("Provider/source mismatch");
  return store.transaction(scope, async tx => {
    if (!await tx.eligible()) return { imported: 0, inAppNotified: 0, state: tx.state, skipped: true, deviceDelivery: "not-attempted" as const };
    const attemptedAt = now().toISOString();
    let page: Page;
    try {
      page = await provider.read(tx.state.resumeCursor ?? tx.state.cursor);
      if (!Array.isArray(page.events) || page.events.length > 200 ||
        !(page.cursor === null || typeof page.cursor === "string") || typeof page.complete !== "boolean" ||
        !(page.checkpointCursor === undefined || typeof page.checkpointCursor === "string") ||
        page.events.some(e => !e.id || !e.title || typeof e.body !== "string" ||
          !(e.occurredAt === null || typeof e.occurredAt === "string") || !e.evidence)) {
        throw new ProviderUnavailable("INVALID_RESPONSE");
      }
    } catch (error) {
      const state: SyncState = { ...tx.state, lastAttempt: attemptedAt, status: "unavailable",
        reason: error instanceof ProviderUnavailable ? error.code : "PROVIDER_UNAVAILABLE" };
      await tx.save(state);
      return { imported: 0, inAppNotified: 0, state, deviceDelivery: "not-attempted" as const };
    }
    let imported = 0, inAppNotified = 0;
    const capturedAt = now().toISOString();
    for (const event of page.events) {
      const result = await tx.insert(event, eventIdentity(scope, event.id), capturedAt);
      imported += result.imported; inAppNotified += result.inAppNotified;
    }
    const state: SyncState = { ...tx.state, lastAttempt: attemptedAt,
      lastSuccess: page.complete ? now().toISOString() : tx.state.lastSuccess,
      cursor: page.complete ? page.cursor : tx.state.cursor,
      resumeCursor: page.complete ? null : page.checkpointCursor ?? tx.state.resumeCursor ?? null,
      status: page.complete ? "success" : "partial", reason: page.complete ? null : "INCOMPLETE_PAGE" };
    await tx.save(state);
    return { imported, inAppNotified, state, deviceDelivery: "not-attempted" as const };
  });
}

/** Deliberately unavailable in production. Activation needs its own reviewed change. */
export const unavailableProvider = (source: Source): Provider => ({
  source, async read() { throw new ProviderUnavailable("DESKTOP_NETWORK_DISABLED"); },
});
