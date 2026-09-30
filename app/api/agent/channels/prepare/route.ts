import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";
import { ensureAgentProfile } from "@/lib/openclaw/service";

const input = z.object({
  channel: z.enum(["EMAIL", "WHATSAPP", "TELEGRAM"]),
  workspaceId: z.string().optional(),
});

function maskedEmail(value: string) {
  const [local, domain] = value.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

function accountId(profileId: string, channel: string) {
  const digest = crypto.createHash("sha256").update(`${profileId}:${channel}`).digest("hex").slice(0, 14);
  return `${channel.toLowerCase()}-${digest}`;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = input.parse(await request.json());
    const viewer = await requireActiveMembership(session.user.id, parsed.workspaceId);
    await requirePermission(session.user.id, viewer.workspaceId, P.AGENT_USE);
    const profile = await ensureAgentProfile(viewer.workspaceId, session.user.id);

    if (parsed.channel === "EMAIL") {
      const gmail = await prisma.googleGmailConnection.findUnique({
        where: { workspaceId_userId: { workspaceId: viewer.workspaceId, userId: session.user.id } },
      });
      if (!gmail) return NextResponse.json({ error: "Conecte o Gmail primeiro." }, { status: 409 });

      const id = `gmail-${gmail.id}`;
      const connection = await prisma.agentChannelConnection.upsert({
        where: {
          workspaceId_userId_channel_accountId: {
            workspaceId: viewer.workspaceId,
            userId: session.user.id,
            channel: "EMAIL",
            accountId: id,
          },
        },
        create: {
          workspaceId: viewer.workspaceId,
          userId: session.user.id,
          agentProfileId: profile.id,
          channel: "EMAIL",
          provider: "GMAIL_MBLZ",
          accountId: id,
          status: "CONNECTED",
          displayName: "Gmail",
          maskedAddress: maskedEmail(gmail.googleEmail),
          consentedAt: new Date(),
          capabilities: { read: true, triage: true, draftReply: true, sendRequiresApproval: true },
        },
        update: {
          status: "CONNECTED",
          maskedAddress: maskedEmail(gmail.googleEmail),
          consentedAt: new Date(),
          disconnectedAt: null,
          lastError: null,
        },
      });
      return NextResponse.json({ connection, setup: "READY" });
    }

    const id = accountId(profile.id, parsed.channel);
    const connection = await prisma.agentChannelConnection.upsert({
      where: {
        workspaceId_userId_channel_accountId: {
          workspaceId: viewer.workspaceId,
          userId: session.user.id,
          channel: parsed.channel,
          accountId: id,
        },
      },
      create: {
        workspaceId: viewer.workspaceId,
        userId: session.user.id,
        agentProfileId: profile.id,
        channel: parsed.channel,
        accountId: id,
        status: "PENDING",
        displayName: parsed.channel === "TELEGRAM" ? "Telegram" : "WhatsApp",
        consentedAt: new Date(),
        capabilities: {
          receive: true,
          reply: true,
          media: true,
          externalSendRequiresApproval: true,
        },
      },
      update: {
        status: "PENDING",
        consentedAt: new Date(),
        disconnectedAt: null,
        lastError: null,
      },
    });

    return NextResponse.json({
      connection,
      setup: parsed.channel === "TELEGRAM" ? "BOT_TOKEN_REQUIRED" : "QR_PAIRING_REQUIRED",
      accountId: id,
    });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível preparar o canal." }, { status });
  }
}
