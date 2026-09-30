import type { Prisma } from "@/generated/prisma/client";

export type Viewer = {
  id: string;
  userId: string;
  workspaceId: string;
  status: string;
  role: { permissions: unknown } | null;
};

export function allows(viewer: Viewer, permission: string): boolean {
  if (viewer.status !== "ACTIVE") return false;
  const raw = viewer.role?.permissions;
  if (!raw || typeof raw !== "object") return false;
  const value = raw as Record<string, unknown>;
  const permissions = Array.isArray(value.allow)
    ? value.allow
    : Object.keys(value).filter(key => value[key] === true);
  return permissions.includes("*") || permissions.includes(permission);
}

const denied = { id: { in: [] as string[] } };

export function matterScope(viewer: Viewer): Prisma.MatterWhereInput {
  return allows(viewer, "matters.view") ? {
    workspaceId: viewer.workspaceId,
    OR: [{ secrecy: false }, { access: { some: { memberId: viewer.id } } }],
  } : denied;
}

export function linkedMatterScope(viewer: Viewer) {
  return { OR: [{ matterId: null }, { matter: matterScope(viewer) }] };
}

// A linked document also inherits confidentiality from its contracts.
export function documentScope(viewer: Viewer): Prisma.LegalDocumentWhereInput {
  return allows(viewer, "documents.view") ? {
    workspaceId: viewer.workspaceId,
    AND: [linkedMatterScope(viewer), {
      contracts: { every: { workspaceId: viewer.workspaceId, ...linkedMatterScope(viewer) } },
    }],
  } : denied;
}

export function contractScope(viewer: Viewer): Prisma.ContractWhereInput {
  return allows(viewer, "contracts.view") ? {
    workspaceId: viewer.workspaceId,
    AND: [linkedMatterScope(viewer), {
      OR: [{ documentId: null }, { document: documentScope(viewer) }],
    }],
  } : denied;
}

export function taskScope(viewer: Viewer): Prisma.LegalTaskWhereInput {
  return allows(viewer, "tasks.view") ? {
    workspaceId: viewer.workspaceId,
    AND: [linkedMatterScope(viewer), { OR: [
      { private: false }, { requesterUserId: viewer.userId },
      { assigneeUserId: viewer.userId }, { reviewerUserId: viewer.userId },
    ] }],
  } : denied;
}

export function deadlineScope(viewer: Viewer): Prisma.DeadlineWhereInput {
  return allows(viewer, "deadlines.view") ? {
    workspaceId: viewer.workspaceId, ...linkedMatterScope(viewer),
    AND: [{ OR: [{ communicationId: null }, { communication: {
      workspaceId: viewer.workspaceId, ...linkedMatterScope(viewer),
    } }] }],
  } : denied;
}

export function inboxScope(viewer: Viewer) {
  return allows(viewer, "matters.view")
    ? { workspaceId: viewer.workspaceId, ...linkedMatterScope(viewer) }
    : denied;
}
