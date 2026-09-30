import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { P, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";
import { runMblzAgent } from "@/lib/openclaw/service";
import { openClawConfigured } from "@/lib/openclaw/client";

const input = z.object({
  message: z.string().trim().min(2).max(12_000),
  workspaceId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!openClawConfigured()) return NextResponse.json({ error: "MBLZ Agent ainda não está configurado no servidor." }, { status: 503 });

  try {
    const parsed = input.parse(await request.json());
    const viewer = await requireActiveMembership(session.user.id, parsed.workspaceId);
    await requirePermission(session.user.id, viewer.workspaceId, P.AGENT_USE);
    const result = await runMblzAgent({ viewer, message: parsed.message, channel: "WEB" });
    return NextResponse.json(result);
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível executar o agente." }, { status });
  }
}
