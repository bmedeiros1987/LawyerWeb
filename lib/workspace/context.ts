import { prisma } from "@/lib/prisma";

export async function getActiveMembership(userId: string, preferredWorkspaceId?: string | null) {
  if (preferredWorkspaceId) {
    return prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: preferredWorkspaceId, userId } },
      include: { workspace: true, role: true },
    });
  }
  return prisma.workspaceMember.findFirst({
    where: { userId, status: "ACTIVE" },
    include: { workspace: true, role: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function requireActiveMembership(userId: string, preferredWorkspaceId?: string | null) {
  const membership = await getActiveMembership(userId, preferredWorkspaceId);
  if (!membership || membership.status !== "ACTIVE") {
    const error = new Error("Workspace membership not found");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }
  return membership;
}
