import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { documentScope } from "@/lib/authz/visibility";
import { canAccessMatter, P } from "@/lib/authz/permissions";
import { documentsMember } from "@/lib/desktop/access";
import { desktopJson, failure, ok } from "@/lib/desktop/http";
import { DesktopError, isDesktop } from "@/lib/desktop/env";
import { SOURCE } from "@/lib/desktop/documents";
import { authorizedVersionText } from "@/lib/ai/document-text";
import { compareTexts } from "@/lib/compare/compare";
import { resolveProvider } from "@/lib/ai/provider";

// Local, deterministic comparison of two document versions the member may view (documents.view, workspace,
// document scope and matter confidentiality are checked for EACH version). Read-only: nothing is written to a
// document or sent anywhere. The optional AI status is informational; no AI call is made here.
const input = z.object({ leftVersionId: z.string().min(1).max(64), rightVersionId: z.string().min(1).max(64) }).strict();

export async function GET() {
  try {
    if (!isDesktop()) throw new DesktopError("Not found", 404);
    const { userId, member } = await documentsMember(false);
    const rows = await prisma.documentVersion.findMany({
      where: { source: SOURCE, storageKey: { not: null }, document: { AND: [{ workspaceId: member.workspaceId }, documentScope(member)] } },
      select: { id: true, version: true, originalName: true, document: { select: { id: true, name: true, matterId: true } } },
      orderBy: [{ document: { updatedAt: "desc" } }, { version: "desc" }], take: 300,
    });
    // Confidential matters: only those the member can open (same rule as the document page).
    const visible = [];
    const cache = new Map<string, boolean>();
    for (const r of rows) {
      const m = r.document.matterId;
      if (m) { if (!cache.has(m)) cache.set(m, await canAccessMatter(userId, member.workspaceId, m, P.MATTERS_VIEW).catch(() => false)); if (!cache.get(m)) continue; }
      visible.push({ id: r.id, documentId: r.document.id, label: `${r.document.name} · versão ${r.version}${r.originalName ? " · " + r.originalName : ""}` });
    }
    return ok({ versions: visible });
  } catch (e) { return failure(e); }
}

export async function POST(request: Request) {
  try {
    const body = await desktopJson(request, input);
    const { userId, member } = await documentsMember(false);
    const left = await authorizedVersionText(userId, member, body.leftVersionId);
    const right = body.rightVersionId === body.leftVersionId ? left : await authorizedVersionText(userId, member, body.rightVersionId);
    const result = compareTexts(left.text, right.text);
    const meta = (d: typeof left) => ({ versionId: d.versionId, documentId: d.documentId, documentName: d.documentName, version: d.version, originalName: d.originalName, fileSha256: d.fileSha256 });
    if (result.status === "ok") {
      await prisma.activityLog.create({ data: {
        workspaceId: member.workspaceId, userId, type: "DOCUMENT_COMPARED", entityType: "LegalDocument", entityId: left.documentId, source: "DESKTOP",
        summary: `Comparação local de versões (${result.observations.length} observação(ões))`,
        // Ids, hashes and counts only: never document text.
        metadata: { leftVersionId: left.versionId, rightVersionId: right.versionId, leftSha256: result.left.sha256, rightSha256: result.right.sha256, stats: result.stats, observations: result.observations.length },
      } });
    }
    const ai = resolveProvider(process.env.MBLZ_AI_PROVIDER).status();
    return ok({ left: meta(left), right: meta(right), result, ai: { state: ai.state, label: ai.label, reason: ai.reason }, sent: "nada foi enviado a nenhum serviço" });
  } catch (e) { return failure(e); }
}
