import { z } from "zod";
import { desktopJson, failure, ok, sessionMember } from "@/lib/desktop/http";
import { DesktopError, isDesktop } from "@/lib/desktop/env";
import { requireOwner } from "@/lib/desktop/auth";
import { aiProviderSummary, clearAiProvider, currentProvider, saveAiProvider } from "@/lib/ai/config";
import { ByokConfigError } from "@/lib/ai/byok";
import { prisma } from "@/lib/prisma";

// Installation-wide setting that spends the owner's own account: owner only. The key is never returned
// (only its last 4 characters) and never written to the audit log.
const body = z.object({
  kind: z.enum(["anthropic", "openai-compatible"]), model: z.string().min(1).max(100),
  baseUrl: z.string().max(300).nullish(), apiKey: z.string().min(8).max(400),
}).strict();

async function audit(userId: string, workspaceId: string | undefined, summary: string, metadata: object) {
  if (!workspaceId) return;
  await prisma.activityLog.create({ data: { workspaceId, userId, type: "AI_PROVIDER_CHANGED", entityType: "Workspace", entityId: workspaceId, source: "DESKTOP", summary, metadata } });
}

export async function GET() {
  try {
    if (!isDesktop()) throw new DesktopError("Not found", 404);
    await requireOwner((await sessionMember()).userId);
    return ok({ settings: await aiProviderSummary(), provider: (await currentProvider()).status() });
  } catch (e) { return failure(e); }
}

export async function PUT(request: Request) {
  try {
    const input = await desktopJson(request, body);
    const { userId, member } = await sessionMember();
    await requireOwner(userId);
    try { const s = await saveAiProvider(input); await audit(userId, member?.workspaceId, "Provedor de IA configurado", { kind: s.kind, model: s.model, baseUrl: s.baseUrl }); return ok({ settings: s }); }
    catch (e) { if (e instanceof ByokConfigError) throw new DesktopError(e.message, 400); throw e; }
  } catch (e) { return failure(e); }
}

export async function DELETE(request: Request) {
  try {
    await desktopJson(request, z.object({}).strict()); // same-origin JSON only, like every write
    const { userId, member } = await sessionMember();
    await requireOwner(userId);
    await clearAiProvider();
    await audit(userId, member?.workspaceId, "Provedor de IA removido", {});
    return ok({ settings: { configured: false } });
  } catch (e) { return failure(e); }
}
