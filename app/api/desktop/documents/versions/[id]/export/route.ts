import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { desktopJson, failure, ok } from "@/lib/desktop/http";
import { accessibleVersion } from "@/lib/desktop/access";
import { exportVersion } from "@/lib/desktop/documents";

const input = z.object({ destPath: z.string().min(1).max(4096), overwrite: z.boolean().optional(), confirmation: z.string().max(40).optional() }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await desktopJson(request, input);
    const { userId, member, version } = await accessibleVersion((await params).id);
    const r = await exportVersion({ versionId: version.id, workspaceId: member.workspaceId, destPath: body.destPath, overwrite: body.overwrite, confirmation: body.confirmation });
    await prisma.activityLog.create({ data: { workspaceId: member.workspaceId, userId, type: "DOCUMENT_EXPORTED", entityType: "LegalDocument", entityId: version.documentId,
      summary: `Versão ${version.version} exportada${r.replaced ? " (substituindo arquivo existente)" : ""}`, source: "DESKTOP", metadata: { replaced: r.replaced, syncFolder: r.syncFolder } } });
    return ok(r);
  } catch (e) { return failure(e); }
}
