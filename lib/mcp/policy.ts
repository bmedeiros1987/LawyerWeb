// Authorization policy for OPTIONAL external MCP/API clients (e.g. a personal assistant or Manus as a
// complementary auditor). This is a pure decision layer only: there is NO transport, OAuth flow, token,
// persistent access or endpoint here, so nothing can be "connected" through this file.
//
// Rules enforced on EVERY call (never once per session):
//   * the grant belongs to the calling user and workspace and is neither expired nor revoked;
//   * the grant lists the exact scope the tool needs, and the document (if any) is in the grant;
//   * the user's current role still allows the permission (checked by the caller via `holdsPermission`);
//   * phase 1 is read-only: any tool that mutates is refused, regardless of grant;
//   * a mutation (later phase) needs a single-use confirmation bound to the exact parameters.
import crypto from "node:crypto";

export const READ_ONLY_PHASE = true;

export type McpTool = { name: string; mutates: boolean; scope: string; permission: string };
export type Grant = { id: string; userId: string; workspaceId: string; scopes: readonly string[]; documentIds?: readonly string[]; expiresAt: number; revokedAt?: number | null };
export type Call = { userId: string; workspaceId: string; documentId?: string; params: unknown };
export type Decision = { allow: true } | { allow: false; reason: "wrong-user" | "wrong-workspace" | "expired" | "revoked" | "scope" | "document-not-granted" | "permission" | "read-only-phase" | "confirmation-required" | "confirmation-invalid" };

/** Initial catalogue: read-only, minimal. Names are ours; no external product's tool names are assumed. */
export const READ_ONLY_TOOLS: readonly McpTool[] = Object.freeze([
  { name: "documents.list_visible", mutates: false, scope: "documents:read", permission: "documents.view" },
  { name: "documents.read_excerpt", mutates: false, scope: "documents:read", permission: "documents.view" },
]);

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** What the user is shown and approves for a mutation: tool + exact parameters + who + where. */
export function confirmationDigest(tool: McpTool, call: Call): string {
  return crypto.createHash("sha256").update(stableJson({ tool: tool.name, userId: call.userId, workspaceId: call.workspaceId, documentId: call.documentId ?? null, params: call.params })).digest("hex");
}

export type Confirmation = { digest: string; expiresAt: number; used?: boolean };

export function decide(input: { grant: Grant; tool: McpTool; call: Call; now: number; holdsPermission: boolean; confirmation?: Confirmation }): Decision {
  const { grant, tool, call, now } = input;
  if (grant.userId !== call.userId) return { allow: false, reason: "wrong-user" };
  if (grant.workspaceId !== call.workspaceId) return { allow: false, reason: "wrong-workspace" };
  if (grant.revokedAt != null && grant.revokedAt <= now) return { allow: false, reason: "revoked" };
  if (grant.expiresAt <= now) return { allow: false, reason: "expired" };
  if (!grant.scopes.includes(tool.scope)) return { allow: false, reason: "scope" };
  if (grant.documentIds && (!call.documentId || !grant.documentIds.includes(call.documentId))) return { allow: false, reason: "document-not-granted" };
  if (!input.holdsPermission) return { allow: false, reason: "permission" };
  if (tool.mutates) {
    if (READ_ONLY_PHASE) return { allow: false, reason: "read-only-phase" };
    const c = input.confirmation;
    if (!c) return { allow: false, reason: "confirmation-required" };
    if (c.used || c.expiresAt <= now || c.digest !== confirmationDigest(tool, call)) return { allow: false, reason: "confirmation-invalid" };
  }
  return { allow: true };
}

/** Audit record: who, which grant, which tool, outcome. Never parameters or document content. */
export function auditRecord(grant: Grant, tool: McpTool, call: Call, decision: Decision, now: number) {
  return { at: new Date(now).toISOString(), grantId: grant.id, userId: call.userId, workspaceId: call.workspaceId, tool: tool.name, documentId: call.documentId ?? null, allowed: decision.allow, reason: decision.allow ? null : decision.reason };
}
