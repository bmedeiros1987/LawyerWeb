// Text of ONE document version, read only after the same workspace/role/confidentiality checks the
// documents screens use. The assistant never receives text the member could not open.
import { prisma } from "@/lib/prisma";
import { DesktopError } from "@/lib/desktop/env";
import { refreshIndex } from "@/lib/desktop/textindex";
import { versionForMember, type DocumentsMember } from "@/lib/desktop/permissions";

export async function authorizedVersionText(userId: string, member: DocumentsMember, versionId: string) {
  const version = await versionForMember(userId, member, versionId, false);
  await refreshIndex([version.id]);
  const rows = await prisma.$queryRaw<{ status: string; note: string | null; content: string; sha256: string }[]>`
    select status, note, content, sha256 from desktop.document_text where version_id = ${version.id}`;
  const row = rows[0];
  if (!row || row.status !== "indexed") throw new DesktopError(row?.note ?? "O texto deste arquivo ainda não pôde ser lido (digitalização sem OCR ou formato sem leitura).", 422, "no-text");
  return { documentId: version.documentId, versionId: version.id, text: row.content, fileSha256: row.sha256 };
}
