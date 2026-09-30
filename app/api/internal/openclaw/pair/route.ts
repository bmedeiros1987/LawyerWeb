import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const input = z.object({
  channel: z.enum(["WHATSAPP", "TELEGRAM"]),
  accountId: z.string().min(3).max(160),
  senderId: z.string().min(1).max(512),
  code: z.string().trim().min(8).max(32),
});

function serviceAuthorized(request: NextRequest) {
  const expected = process.env.MBLZ_AGENT_SERVICE_TOKEN;
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function senderHash(channel: string, senderId: string) {
  const salt = process.env.OPENCLAW_SESSION_SALT;
  if (!salt) throw new Error("OPENCLAW_SESSION_SALT is not configured");
  return crypto.createHmac("sha256", salt).update(`${channel}:${senderId}`).digest("hex");
}

export async function POST(request: NextRequest) {
  if (!serviceAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = input.parse(await request.json());
    const connection = await prisma.agentChannelConnection.findFirst({
      where: { channel: parsed.channel, accountId: parsed.accountId, status: { in: ["PENDING", "CONNECTED"] } },
      include: { agentProfile: true },
    });
    if (!connection || !connection.agentProfile.enabled) {
      return NextResponse.json({ error: "Channel is not prepared in MBLZ" }, { status: 404 });
    }

    const hash = senderHash(parsed.channel, parsed.senderId);
    if (connection.status === "CONNECTED" && connection.externalIdentityHash === hash) {
      return NextResponse.json({ ok: true, alreadyPaired: true });
    }
    if (connection.status === "CONNECTED") {
      return NextResponse.json({ error: "This MBLZ channel is already bound to another sender" }, { status: 409 });
    }

    const metadata = connection.metadata && typeof connection.metadata === "object" && !Array.isArray(connection.metadata)
      ? connection.metadata as Record<string, unknown>
      : {};
    const expectedCodeHash = typeof metadata.pairCodeHash === "string" ? metadata.pairCodeHash : "";
    const expiresAt = typeof metadata.pairExpiresAt === "string" ? new Date(metadata.pairExpiresAt) : null;
    if (!expectedCodeHash || !expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ error: "MBLZ pairing code expired. Generate a new code in Integrations." }, { status: 410 });
    }

    const receivedCodeHash = crypto.createHash("sha256").update(parsed.code.toUpperCase()).digest("hex");
    const a = Buffer.from(expectedCodeHash);
    const b = Buffer.from(receivedCodeHash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return NextResponse.json({ error: "Invalid MBLZ pairing code" }, { status: 403 });
    }

    await prisma.$transaction([
      prisma.agentChannelConnection.update({
        where: { id: connection.id },
        data: {
          status: "CONNECTED",
          externalIdentityHash: hash,
          lastHealthAt: new Date(),
          lastError: null,
          metadata: { pairedAt: new Date().toISOString(), pairingMethod: "MBLZ_CODE" },
        },
      }),
      prisma.activityLog.create({
        data: {
          workspaceId: connection.workspaceId,
          userId: connection.userId,
          type: "AGENT_CHANNEL_PAIRED",
          entityType: "AgentChannelConnection",
          entityId: connection.id,
          summary: `Canal do MBLZ Agent vinculado: ${parsed.channel}`,
          source: "OPENCLAW",
          metadata: { channel: parsed.channel, accountId: parsed.accountId },
        },
      }),
    ]);

    return NextResponse.json({ ok: true, paired: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}
