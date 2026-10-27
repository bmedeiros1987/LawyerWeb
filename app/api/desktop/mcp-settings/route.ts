import { z } from "zod";
import { desktopJson, failure, ok, sessionMember } from "@/lib/desktop/http";
import { DesktopError, desktopStateDir, isDesktop } from "@/lib/desktop/env";
import { requireOwner } from "@/lib/desktop/auth";
import { requireDocumentsPermission } from "@/lib/desktop/permissions";
import { TokenError, createToken, isMcpEnabled, listTokens, revokeToken, setMcpEnabled } from "@/lib/mcp/tokens";
import { prisma } from "@/lib/prisma";

// Manage MCP access. The OWNER switches MCP on/off for the whole installation; each member with
// documents.view creates and revokes tokens for THEIR OWN user (the owner may revoke any). The secret is
// returned once, at creation. The snippet for the AI client is built from paths the shell hands the server.
const audit = async (userId: string, workspaceId: string, summary: string, metadata: object) =>
  prisma.activityLog.create({ data: { workspaceId, userId, type: "MCP_ACCESS_CHANGED", entityType: "Workspace", entityId: workspaceId, source: "DESKTOP", summary, metadata } });

async function ctx() {
  if (!isDesktop()) throw new DesktopError("Not found", 404);
  const { userId, member } = await sessionMember();
  if (!member) throw new DesktopError("Crie ou entre em um workspace primeiro.", 403);
  await requireDocumentsPermission(userId, member, false);
  return { userId, member };
}

export async function GET() {
  try {
    const { userId } = await ctx();
    return ok({
      enabled: await isMcpEnabled(), tokens: await listTokens(userId),
      client: { node: process.env.MBLZ_NODE_PATH ?? null, bridge: process.env.MBLZ_RUNTIME_DIR ? `${process.env.MBLZ_RUNTIME_DIR}/mcp-bridge.mjs` : null, stateDir: desktopStateDir() },
    });
  } catch (e) { return failure(e); }
}

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable"), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("create"), name: z.string().min(1).max(60), days: z.number().int().min(1).max(365).optional() }).strict(),
  z.object({ action: z.literal("revoke"), id: z.string().regex(/^[0-9a-f]{12}$/) }).strict(),
]);

export async function POST(request: Request) {
  try {
    const input = await desktopJson(request, body);
    const { userId, member } = await ctx();
    if (input.action === "enable") {
      await requireOwner(userId);
      await setMcpEnabled(input.enabled);
      await audit(userId, member.workspaceId, input.enabled ? "Acesso MCP ligado" : "Acesso MCP desligado", { enabled: input.enabled });
      return ok({ enabled: input.enabled });
    }
    if (input.action === "create") {
      try {
        const t = await createToken({ userId, workspaceId: member.workspaceId, name: input.name, days: input.days });
        await audit(userId, member.workspaceId, "Acesso MCP criado", { tokenId: t.id, name: t.name, expiresAt: t.expiresAt });
        return ok(t, 201);
      } catch (e) { if (e instanceof TokenError) throw new DesktopError(e.message, e.status); throw e; }
    }
    let owner = false;
    try { await requireOwner(userId); owner = true; } catch { owner = false; }
    const done = await revokeToken(input.id, userId, owner);
    if (!done) throw new DesktopError("Acesso não encontrado.", 404);
    await audit(userId, member.workspaceId, "Acesso MCP revogado", { tokenId: input.id });
    return ok({ revoked: true });
  } catch (e) { return failure(e); }
}
