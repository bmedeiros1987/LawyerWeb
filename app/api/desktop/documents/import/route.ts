import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { documentScope } from "@/lib/authz/visibility";
import { desktopJson, failure, ok } from "@/lib/desktop/http";
import { assertMatterWritable, documentsMember } from "@/lib/desktop/access";
import { importDocument } from "@/lib/desktop/documents";
import { DesktopError } from "@/lib/desktop/env";

const input = z.object({
  sourcePath: z.string().min(1).max(4096),
  clientId: z.string().max(64).nullish(), matterId: z.string().max(64).nullish(), documentId: z.string().max(64).nullish(),
  name: z.string().max(200).nullish(), kind: z.string().max(40).nullish(),
}).strict();

export async function POST(request: Request) {
  try {
    const body = await desktopJson(request, input);
    const { userId, member } = await documentsMember(true);
    let matterId = body.matterId ?? null, clientId = body.clientId ?? null;
    if (body.documentId) {
      const doc = await prisma.legalDocument.findFirst({ where: { id: body.documentId, AND: [documentScope(member)] } });
      if (!doc) throw new DesktopError("Documento não encontrado.", 404);
      matterId = doc.matterId; clientId = doc.clientId;
    }
    await assertMatterWritable(userId, member.workspaceId, matterId);
    if (matterId && !clientId) clientId = (await prisma.matter.findFirst({ where: { id: matterId, workspaceId: member.workspaceId }, select: { clientId: true } }))?.clientId ?? null;
    const r = await importDocument({ userId, workspaceId: member.workspaceId, sourcePath: body.sourcePath, clientId, matterId, documentId: body.documentId, name: body.name, kind: body.kind });
    return ok(r, 201);
  } catch (e) { return failure(e); }
}
