// Authorization for desktop document operations, reusing the web RBAC and
// confidentiality scopes (workspace membership, documents.*, secret matters).
import { P, canAccessMatter } from "@/lib/authz/permissions";
import { DesktopError } from "./env";
import { sessionMember } from "./http";
import { requireDocumentsPermission, versionForMember } from "./permissions";

export async function documentsMember(edit: boolean) {
  const { userId, member } = await sessionMember();
  if (!member) throw new DesktopError("Crie ou entre em um workspace primeiro.", 403);
  return { userId, member: await requireDocumentsPermission(userId, member, edit) };
}

export async function accessibleVersion(versionId: string, edit = false) {
  const { userId, member } = await sessionMember();
  if (!member) throw new DesktopError("Crie ou entre em um workspace primeiro.", 403);
  return { userId, member, version: await versionForMember(userId, member, versionId, edit) };
}

export async function assertMatterWritable(userId: string, workspaceId: string, matterId?: string | null) {
  if (matterId && !(await canAccessMatter(userId, workspaceId, matterId, P.MATTERS_VIEW))) throw new DesktopError("Processo não encontrado.", 404);
}
