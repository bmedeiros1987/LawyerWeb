// "Abrir" a document version on this computer.
//   edit  opens the editable working copy (or reveals its folder): requires documents.edit.
//   editor opens the working copy in the bundled editor (same permission as edit).
//   read  opens a read-only temporary copy: documents.view is enough, and the
//         working copy itself is never handed to the program.
import { prisma } from "@/lib/prisma";
import { openWithSystem, readOnlyCopy, workingCopyPath } from "./documents";
import { DesktopError } from "./env";
import { editorKindFor, openWithEditor } from "./editors";
import { versionForMember, type DocumentsMember } from "./permissions";

export type OpenMode = "edit" | "read" | "editor";

export async function openVersion(input: { userId: string; member: DocumentsMember; versionId: string; mode: OpenMode; reveal?: boolean }) {
  const editable = input.mode === "edit" || input.mode === "editor" || Boolean(input.reveal);
  const version = await versionForMember(input.userId, input.member, input.versionId, editable);
  const file = editable
    ? (await workingCopyPath(version.id, input.member.workspaceId)).file
    : await readOnlyCopy(version.id, input.member.workspaceId);
  const useEditor = input.mode === "editor" && !input.reveal;
  if (useEditor) {
    const kind = editorKindFor(version.originalName ?? file);
    if (!kind) throw new DesktopError("O editor embutido não abre este tipo de arquivo. Use \"Abrir cópia para editar\".", 409, "editor-unavailable");
    const r = await openWithEditor(kind, file);
    if (!r.ok && r.reason === "not-installed") throw new DesktopError("O editor embutido não está disponível nesta instalação. Use \"Abrir cópia para editar\".", 409, "editor-unavailable");
    if (!r.ok) throw new DesktopError(`O editor ${r.message}. Nada foi alterado no documento.${r.log ? ` Detalhes: ${r.log}` : ""} Use \"Abrir cópia para editar\" enquanto isso.`, 502, "editor-failed");
  } else openWithSystem(file, Boolean(input.reveal));
  await prisma.activityLog.create({ data: {
    workspaceId: input.member.workspaceId, userId: input.userId, type: editable ? "DOCUMENT_OPENED_EDIT" : "DOCUMENT_OPENED_READ",
    entityType: "LegalDocument", entityId: version.documentId, source: "DESKTOP",
    summary: `Versão ${version.version} aberta ${useEditor ? "no editor embutido (cópia de trabalho)" : editable ? "para edição (cópia de trabalho)" : "somente leitura (cópia temporária)"}`,
  } });
  return { opened: true, mode: useEditor ? "editor" as const : editable ? "edit" as const : "read" as const, path: file };
}
