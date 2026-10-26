import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { desktopJson, failure, ok } from "@/lib/desktop/http";
import { assertMatterWritable, documentsMember } from "@/lib/desktop/access";
import { importDocument } from "@/lib/desktop/documents";
import { DesktopError } from "@/lib/desktop/env";
import { assessOpenCandidate } from "@/lib/desktop/open-safety";

// Files the operating system asked LawyerMind to open ("Abrir com"). Two explicit steps:
//   assess  read-only checks (path, type, ZIP/PDF safety, SHA-256); changes nothing;
//   import  after the user confirms a specific SHA-256: imports a COPY. The original is only read.
// Importing needs documents.edit, like the manual import. Nothing is sent to any AI or external service.
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assess"), paths: z.array(z.string().min(1).max(4096)).min(1).max(16) }).strict(),
  z.object({
    action: z.literal("import"), confirm: z.literal(true), path: z.string().min(1).max(4096), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    clientId: z.string().max(64).nullish(), matterId: z.string().max(64).nullish(), name: z.string().max(200).nullish(), kind: z.string().max(40).nullish(),
  }).strict(),
]);

export async function POST(request: Request) {
  try {
    const body = await desktopJson(request, input);
    const { userId, member } = await documentsMember(true);
    if (body.action === "assess") {
      const results = [];
      for (const p of body.paths) results.push(await assessOpenCandidate(p));
      return ok({ results });
    }
    const a = await assessOpenCandidate(body.path);
    const blocker = a.findings.find(f => f.severity === "block");
    if (!a.ok || !a.path || blocker) throw new DesktopError(blocker?.message ?? "O arquivo não passou na verificação de segurança.", 422, blocker?.code ?? "blocked");
    if (a.sha256 !== body.sha256) throw new DesktopError("O arquivo mudou desde a verificação. Verifique de novo antes de importar.", 409, "changed");
    const matterId = body.matterId ?? null; let clientId = body.clientId ?? null;
    await assertMatterWritable(userId, member.workspaceId, matterId);
    if (matterId && !clientId) clientId = (await prisma.matter.findFirst({ where: { id: matterId, workspaceId: member.workspaceId }, select: { clientId: true } }))?.clientId ?? null;
    // The real path of the file we just verified: never the string the OS handed us.
    return ok(await importDocument({ userId, workspaceId: member.workspaceId, sourcePath: a.path, clientId, matterId, documentId: null, name: body.name, kind: body.kind }), 201);
  } catch (e) { return failure(e); }
}
