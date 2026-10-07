// Document permissions for the desktop, without request/session dependencies
// (used by the routes through access.ts and directly by the tests).
import { prisma } from "@/lib/prisma";
import { P, canAccessMatter, memberWithPermission } from "@/lib/authz/permissions";
import { documentScope } from "@/lib/authz/visibility";
import { DesktopError } from "./env";
import { SOURCE } from "./documents";

export type DocumentsMember = Parameters<typeof documentScope>[0] & { workspaceId: string };

export async function requireDocumentsPermission<M extends DocumentsMember>(userId: string, member: M, edit: boolean): Promise<M> {
  if (!(await memberWithPermission(userId, member.workspaceId, edit ? P.DOCUMENTS_EDIT : P.DOCUMENTS_VIEW))) throw new DesktopError("Seu perfil não tem permissão para esta ação.", 403);
  return member;
}

/** The version, if this member may see it (edit: also change it, i.e. documents.edit). */
export async function versionForMember(userId: string, member: DocumentsMember, versionId: string, edit: boolean) {
  await requireDocumentsPermission(userId, member, edit);
  const v = await prisma.documentVersion.findFirst({
    where: { id: versionId, source: SOURCE, document: { AND: [{ workspaceId: member.workspaceId }, documentScope(member)] } },
    include: { document: true },
  });
  if (!v) throw new DesktopError("Documento não encontrado.", 404);
  if (v.document.matterId && !(await canAccessMatter(userId, member.workspaceId, v.document.matterId, P.MATTERS_VIEW))) throw new DesktopError("Documento não encontrado.", 404);
  return v;
}

