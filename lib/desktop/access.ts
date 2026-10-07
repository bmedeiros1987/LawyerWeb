// Authorization for desktop document operations, reusing the web RBAC and
// confidentiality scopes (workspace membership, documents.*, secret matters).
import { prisma } from "@/lib/prisma";
import { P, canAccessMatter, memberWithPermission } from "@/lib/authz/permissions";
import { documentScope } from "@/lib/authz/visibility";
import { DesktopError } from "./env";
import { sessionMember } from "./http";
import { SOURCE } from "./documents";

export async function documentsMember(edit: boolean) {
  const { userId, member } = await sessionMember();
  if (!member) throw new DesktopError("Crie ou entre em um workspace primeiro.", 403);
  if (!(await memberWithPermission(userId, member.workspaceId, edit ? P.DOCUMENTS_EDIT : P.DOCUMENTS_VIEW))) throw new DesktopError("Seu perfil não tem permissão para esta ação.", 403);
  return { userId, member };
}

export async function accessibleVersion(versionId: string, edit = false) {
  const { userId, member } = await documentsMember(edit);
  const v = await prisma.documentVersion.findFirst({
    where: { id: versionId, source: SOURCE, document: { AND: [{ workspaceId: member.workspaceId }, documentScope(member)] } },
    include: { document: true },
  });
  if (!v) throw new DesktopError("Documento não encontrado.", 404);
  if (v.document.matterId && !(await canAccessMatter(userId, member.workspaceId, v.document.matterId, P.MATTERS_VIEW))) throw new DesktopError("Documento não encontrado.", 404);
  return { userId, member, version: v };
}

export async function assertMatterWritable(userId: string, workspaceId: string, matterId?: string | null) {
  if (matterId && !(await canAccessMatter(userId, workspaceId, matterId, P.MATTERS_VIEW))) throw new DesktopError("Processo não encontrado.", 404);
}
