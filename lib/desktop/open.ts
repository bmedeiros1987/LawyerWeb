// "Abrir" a document version on this computer.
//   edit  opens the editable working copy (or reveals its folder): requires documents.edit.
//   read  opens a read-only temporary copy: documents.view is enough, and the
//         working copy itself is never handed to the program.
import { prisma } from "@/lib/prisma";
import { openWithSystem, readOnlyCopy, workingCopyPath } from "./documents";
import { versionForMember, type DocumentsMember } from "./permissions";

export type OpenMode = "edit" | "read";

export async function openVersion(input: { userId: string; member: DocumentsMember; versionId: string; mode: OpenMode; reveal?: boolean }) {
  const editable = input.mode === "edit" || Boolean(input.reveal);
  const version = await versionForMember(input.userId, input.member, input.versionId, editable);
  const file = editable
    ? (await workingCopyPath(version.id, input.member.workspaceId)).file
    : await readOnlyCopy(version.id, input.member.workspaceId);
  openWithSystem(file, Boolean(input.reveal));
  await prisma.activityLog.create({ data: {
    workspaceId: input.member.workspaceId, userId: input.userId, type: editable ? "DOCUMENT_OPENED_EDIT" : "DOCUMENT_OPENED_READ",
    entityType: "LegalDocument", entityId: version.documentId, source: "DESKTOP",
    summary: `Versão ${version.version} aberta ${editable ? "para edição (cópia de trabalho)" : "somente leitura (cópia temporária)"}`,
  } });
  return { opened: true, mode: editable ? "edit" as const : "read" as const, path: file };
}
