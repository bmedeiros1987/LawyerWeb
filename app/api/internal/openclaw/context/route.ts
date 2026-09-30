import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { buildAgentContext } from "@/lib/openclaw/context";

const input = z.object({
  channel: z.enum(["WHATSAPP", "TELEGRAM"]),
  accountId: z.string().min(3).max(160),
  senderId: z.string().min(1).max(512),
});

function senderHash(channel: string, senderId: string) {
  const salt = process.env.OPENCLAW_SESSION_SALT;
  if (!salt) throw new Error("OPENCLAW_SESSION_SALT is not configured");
  return crypto.createHmac("sha256", salt).update(`${channel}:${senderId}`).digest("hex");
}

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
        status: "CONNECTED",
      },
      include: {
        agentProfile: true,
        workspace: { select: { id: true, name: true, timezone: true } },
      },
    });
    if (!connection || !connection.agentProfile.enabled) {
      return NextResponse.json({ error: "Channel is not authorized in MBLZ" }, { status: 404 });
    }
    const hash = senderHash(parsed.channel, parsed.senderId);
    const expectedHash = connection.externalIdentityHash ?? "";
    const a = Buffer.from(expectedHash);
    const b = Buffer.from(hash);
    if (!expectedHash || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return NextResponse.json({ error: "Sender is not bound to this MBLZ channel" }, { status: 403 });
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: connection.workspaceId, userId: connection.userId } },
      include: { role: true },
    });
    if (!member || member.status !== "ACTIVE") return NextResponse.json({ error: "User access is inactive" }, { status: 403 });

    const context = await buildAgentContext(member);
    await prisma.agentChannelConnection.update({
      where: { id: connection.id },
      data: { lastHealthAt: new Date(), lastError: null },
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
