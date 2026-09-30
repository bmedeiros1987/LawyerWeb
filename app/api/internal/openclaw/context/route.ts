import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { buildAgentContext } from "@/lib/openclaw/context";

const input = z.object({
  channel: z.enum(["WHATSAPP", "TELEGRAM"]),
  accountId: z.string().min(3).max(160),
});

function authorized(request: NextRequest) {
  const expected = process.env.MBLZ_AGENT_SERVICE_TOKEN;
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const parsed = input.parse(await request.json());
    const connection = await prisma.agentChannelConnection.findFirst({
      where: {
        channel: parsed.channel,
        accountId: parsed.accountId,
        status: { in: ["PENDING", "CONNECTED"] },
      },
      include: {
        agentProfile: true,
        workspace: { select: { id: true, name: true, timezone: true } },
      },
    });
    if (!connection || !connection.agentProfile.enabled) {
      return NextResponse.json({ error: "Channel is not authorized in MBLZ" }, { status: 404 });
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: connection.workspaceId, userId: connection.userId } },
      include: { role: true },
    });
    if (!member || member.status !== "ACTIVE") return NextResponse.json({ error: "User access is inactive" }, { status: 403 });

    const context = await buildAgentContext(member);
    await prisma.agentChannelConnection.update({
      where: { id: connection.id },
      data: { status: "CONNECTED", lastHealthAt: new Date(), lastError: null },
    });

    return NextResponse.json({
      workspace: { name: connection.workspace.name, timezone: connection.workspace.timezone },
      policy: {
        readOnlyContext: true,
        legalDeadlineConfirmation: "HUMAN_ONLY",
        externalSend: "NORMAL_CHANNEL_REPLY_ONLY",
        destructiveActions: "DENIED",
      },
      context,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}
