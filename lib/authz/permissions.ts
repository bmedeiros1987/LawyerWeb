import { prisma } from "@/lib/prisma";

export const P = {
  WORKSPACE_MANAGE: "workspace.manage",
  MEMBERS_MANAGE: "members.manage",
  MATTERS_VIEW: "matters.view",
  MATTERS_EDIT: "matters.edit",
  MATTERS_DELETE: "matters.delete",
  CLIENTS_VIEW: "clients.view",
  CLIENTS_EDIT: "clients.edit",
  DEADLINES_VIEW: "deadlines.view",
  DEADLINES_CREATE: "deadlines.create",
  DEADLINES_CONFIRM: "deadlines.confirm",
  DEADLINES_COMPLETE: "deadlines.complete",
  DEADLINES_MANAGE: "deadlines.manage",
  TASKS_VIEW: "tasks.view",
  TASKS_EDIT: "tasks.edit",
  DOCUMENTS_VIEW: "documents.view",
  DOCUMENTS_EDIT: "documents.edit",
  DOCUMENTS_SIGN: "documents.sign",
  CONTRACTS_VIEW: "contracts.view",
  CONTRACTS_EDIT: "contracts.edit",
  FINANCE_VIEW: "finance.view",
  FINANCE_EDIT: "finance.edit",
  REPORTS_VIEW: "reports.view",
  AUDIT_VIEW: "audit.view",
  INTEGRATIONS_MANAGE: "integrations.manage",
} as const;

export type Permission = (typeof P)[keyof typeof P];

function permissionSet(value: unknown): Set<string> {
  if (!value || typeof value !== "object") return new Set();
  const raw = value as Record<string, unknown>;
  if (Array.isArray(raw.allow)) return new Set(raw.allow.filter((v): v is string => typeof v === "string"));
  return new Set(Object.entries(raw).filter(([, v]) => v === true).map(([k]) => k));
}

export async function memberWithPermission(userId: string, workspaceId: string, permission: Permission) {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    include: { role: true },
  });
  if (!member || member.status !== "ACTIVE") return null;
  const set = permissionSet(member.role?.permissions);
  if (set.has("*") || set.has(permission)) return member;
  return null;
}

export async function requirePermission(userId: string, workspaceId: string, permission: Permission) {
  const member = await memberWithPermission(userId, workspaceId, permission);
  if (!member) {
    const error = new Error("Forbidden");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }
  return member;
}

export async function canAccessMatter(userId: string, workspaceId: string, matterId: string, permission: Permission) {
  const member = await requirePermission(userId, workspaceId, permission);
  const matter = await prisma.matter.findFirst({ where: { id: matterId, workspaceId }, select: { secrecy: true } });
  if (!matter) return false;
  if (!matter.secrecy) return true;
  const explicit = await prisma.matterAccess.findUnique({
    where: { matterId_memberId: { matterId, memberId: member.id } },
    select: { id: true },
  });
  return Boolean(explicit);
}