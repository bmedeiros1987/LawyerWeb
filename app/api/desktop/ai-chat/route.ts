import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { documentsMember } from "@/lib/desktop/access";
import { desktopJson, failure, ok, noStore } from "@/lib/desktop/http";
import { DesktopError, isDesktop } from "@/lib/desktop/env";
import { authorizedVersionText } from "@/lib/ai/document-text";
import { ChatInputError, MAX_EXCERPT, askAboutExcerpt } from "@/lib/ai/chat";
import { currentProvider } from "@/lib/ai/config";
import { NextResponse } from "next/server";

// The provider is the owner's own key (Configurações) or an adapter a maintainer registered; with
// neither, this route answers "unavailable" and never sends a document anywhere. Every send needs
// `consent: true` for that request.
const input = z.object({
  versionId: z.string().min(1).max(64), start: z.number().int().nonnegative(), end: z.number().int().positive(),
  question: z.string().min(1).max(2000), consent: z.literal(true), freeTierAck: z.boolean().optional(),
}).strict();

export async function GET(request: Request) {
  try {
    if (!isDesktop()) throw new DesktopError("Not found", 404);
    const { userId, member } = await documentsMember(false);
    const url = new URL(request.url), versionId = url.searchParams.get("versionId");
    if (!versionId) return ok({ provider: (await currentProvider()).status() });
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) | 0);
    const doc = await authorizedVersionText(userId, member, versionId);
    return ok({ provider: (await currentProvider()).status(), window: { offset, length: doc.text.length, text: doc.text.slice(offset, offset + MAX_EXCERPT), max: MAX_EXCERPT } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const body = await desktopJson(request, input);
    const { userId, member } = await documentsMember(false);
    const provider = await currentProvider();
    // Free plans: the user must also confirm the excerpt holds no client/confidential data.
    if (provider.status().freeTier && body.freeTierAck !== true) throw new DesktopError("Plano gratuito: confirme que o trecho não contém dados de clientes ou sigilosos.", 428, "free-tier-ack");
    const doc = await authorizedVersionText(userId, member, body.versionId);
    const result = await askAboutExcerpt({
      provider, text: doc.text, ref: { documentId: doc.documentId, versionId: doc.versionId }, start: body.start, end: body.end, question: body.question,
      // Metadata only: never the question, the excerpt or the answer.
      audit: async e => { await prisma.activityLog.create({ data: { workspaceId: member.workspaceId, userId, type: "AI_CHAT_ASKED", entityType: "LegalDocument", entityId: doc.documentId, source: "DESKTOP", summary: `Pergunta à IA sobre trecho (${e.outcome})`, metadata: e } }); },
    });
    if (result.status === "unavailable") return NextResponse.json({ ...result, error: result.message, code: "provider-unavailable" }, { status: 503, headers: noStore });
    if (result.status === "error") return NextResponse.json({ ...result, error: result.message, code: result.code }, { status: 502, headers: noStore });
    return ok(result);
  } catch (error) {
    if (error instanceof ChatInputError) return failure(new DesktopError(error.message, error.status));
    return failure(error);
  }
}
