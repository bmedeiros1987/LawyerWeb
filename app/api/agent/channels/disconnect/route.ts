import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";

const input = z.object({
  channel: z.enum(["EMAIL", "WHATSAPP", "TELEGRAM"]),
  workspaceId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = input.parse(await request.json());
    const viewer = await requireActiveMembership(session.user.id, parsed.workspaceId);
    await requirePermission(session.user.id, viewer.workspaceId, P.AGENT_USE);

    const result = await prisma.agentChannelConnection.updateMany({
      where: {
        workspaceId: viewer.workspaceId,
        userId: session.user.id,
        channel: parsed.channel,
        status: { not: "DISCONNECTED" },
      },
      data: {
        status: "DISCONNECTED",
        disconnectedAt: new Date(),
        lastError: null,
      },
    });

    await prisma.activityLog.create({
      data: {
        workspaceId: viewer.workspaceId,
        userId: session.user.id,
        type: "AGENT_CHANNEL_DISCONNECTED",
        entityType: "AgentChannelConnection",
        summary: `Canal do MBLZ Agent desconectado: ${parsed.channel}`,
        source: "OPENCLAW",
        metadata: { channel: parsed.channel, affected: result.count },
      },
    });

    return NextResponse.json({ ok: true, disconnected: result.count });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível desconectar o canal." }, { status });
  }
}
