import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createMblzAgentToken, MBLZ_AGENT_SCOPES } from "@/lib/agent/token";
import { requireActiveMembership } from "@/lib/workspace/context";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({})) as { workspaceId?: unknown };
    const preferredWorkspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : undefined;
    const member = await requireActiveMembership(session.user.id, preferredWorkspaceId);
    const { token, claims } = createMblzAgentToken({
      userId: session.user.id,
      workspaceId: member.workspaceId,
      scopes: [...MBLZ_AGENT_SCOPES],
      ttlSeconds: 24 * 60 * 60,
    });
    return NextResponse.json({
      token,
      tokenType: "Bearer",
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      workspaceId: member.workspaceId,
      scopes: claims.scopes,
    }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent token unavailable";
    const status = message.includes("SIGNING_SECRET") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
