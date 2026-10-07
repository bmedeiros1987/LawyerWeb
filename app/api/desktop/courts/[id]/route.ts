import { z } from "zod";
import { P, canAccessMatter, memberWithPermission } from "@/lib/authz/permissions";
import { desktopJson, sessionMember, ok, failure } from "@/lib/desktop/http";
import { DesktopError, isDesktop } from "@/lib/desktop/env";
import { courtState, courtStore } from "@/lib/desktop/court-store";
import { syncCourt, unavailableProvider, type Scope } from "@/lib/desktop/court-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function scopeFor(id: string, source: Scope["source"]): Promise<Scope> {
  if (!isDesktop()) throw new DesktopError("Not found", 404);
  const { userId, member } = await sessionMember();
  if (!member || member.status !== "ACTIVE" ||
    !await memberWithPermission(userId, member.workspaceId, P.MATTERS_VIEW))
    throw new DesktopError("Processo não encontrado.", 404);
  try {
    if (!await canAccessMatter(userId, member.workspaceId, id, P.MATTERS_VIEW))
      throw new DesktopError("Processo não encontrado.", 404);
  } catch (error) {
    if ((error as { status?: number })?.status === 403)
      throw new DesktopError("Processo não encontrado.", 404);
    throw error;
  }
  return { workspaceId: member.workspaceId, matterId: id, source, actorUserId: userId };
}
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const scope = await scopeFor(id, "DATAJUD");
    return ok({ mode: "manual-disabled", networkEnabled: false, deviceDelivery: "not-attempted",
      sources: {
        DATAJUD: await courtState(scope),
        DJEN: await courtState({ ...scope, source: "DJEN" }),
      } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const body = await desktopJson(request, z.object({ source: z.enum(["DATAJUD", "DJEN"]) }).strict());
    const { id } = await context.params;
    const scope = await scopeFor(id, body.source);
    // No feature flag or credential can silently activate network access in this cut.
    const result = await syncCourt(scope, unavailableProvider(body.source), courtStore);
    return ok({ ...result, mode: "manual-disabled", networkEnabled: false });
  } catch (error) { return failure(error); }
}
