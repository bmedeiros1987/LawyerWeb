import { getActiveMembership } from "@/lib/workspace/context";
import type { MblzAgentClaims } from "@/lib/agent/token";
import type { Viewer } from "@/lib/authz/visibility";

export async function agentViewer(claims: MblzAgentClaims): Promise<Viewer & { workspace: { id: string; name: string; timezone: string } }> {
  const member = await getActiveMembership(claims.userId, claims.workspaceId);
  if (!member || member.status !== "ACTIVE" || member.workspaceId !== claims.workspaceId) {
    const error = new Error("Agent membership no longer active");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }
  return member;
}
