import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { encryptSecret, sha256 } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";
import { inspectWhatsAppPhone, newWhatsAppWebhookSecrets } from "@/lib/agent/whatsapp";

const input = z.object({
  workspaceId: z.string().optional(),
  accessToken: z.string().trim().min(30).max(4096),
  appSecret: z.string().trim().min(16).max(512),
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/),
  graphVersion: z.string().trim().regex(/^v\d+\.\d+$/),
});

function appUrl() {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) throw new Error("NEXT_PUBLIC_APP_URL não configurado.");
  const url = new URL(raw);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("O domínio público do MBLZ deve usar HTTPS.");
  return url.toString().replace(/\/$/, "");
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const member = await requireActiveMembership(session.user.id, request.nextUrl.searchParams.get("workspaceId"));
    await requirePermission(session.user.id, member.workspaceId, P.AGENT_USE);
    const connection = await prisma.agentChannelConnection.findUnique({
      where: { workspaceId_channel_accountKey: { workspaceId: member.workspaceId, channel: "WHATSAPP", accountKey: "workspace-cloud" } },
      select: { id: true, displayName: true, status: true, externalIdentity: true, connectedAt: true, revokedAt: true, config: true },
    });
    return NextResponse.json({ connection }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Solicitação inválida" }, { status });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const parsed = input.parse(await request.json());
    const member = await requireActiveMembership(session.user.id, parsed.workspaceId);
    await requirePermission(session.user.id, member.workspaceId, P.AGENT_MANAGE);

    const phone = await inspectWhatsAppPhone({
      accessToken: parsed.accessToken,
      phoneNumberId: parsed.phoneNumberId,
      graphVersion: parsed.graphVersion,
    });
    const webhook = newWhatsAppWebhookSecrets();
    const previous = await prisma.agentChannelConnection.findUnique({
      where: { workspaceId_channel_accountKey: { workspaceId: member.workspaceId, channel: "WHATSAPP", accountKey: "workspace-cloud" } },
      select: { id: true, externalIdentity: true },
    });
    const phoneChanged = Boolean(previous?.externalIdentity && previous.externalIdentity !== phone.phoneNumberId);

    const connection = await prisma.agentChannelConnection.upsert({
      where: { workspaceId_channel_accountKey: { workspaceId: member.workspaceId, channel: "WHATSAPP", accountKey: "workspace-cloud" } },
      create: {
        workspaceId: member.workspaceId,
        userId: null,
        channel: "WHATSAPP",
        accountKey: "workspace-cloud",
        displayName: phone.displayPhoneNumber,
        status: "PENDING",
        secretEnc: encryptSecret(parsed.accessToken),
        webhookSecretEnc: encryptSecret(JSON.stringify({ appSecret: parsed.appSecret, verifyToken: webhook.verifyToken })),
        externalIdentity: phone.phoneNumberId,
        config: phone,
        revokedAt: null,
      },
      update: {
        displayName: phone.displayPhoneNumber,
        status: "PENDING",
        secretEnc: encryptSecret(parsed.accessToken),
        webhookSecretEnc: encryptSecret(JSON.stringify({ appSecret: parsed.appSecret, verifyToken: webhook.verifyToken })),
        externalIdentity: phone.phoneNumberId,
        config: phone,
        revokedAt: null,
      },
    });

    const now = new Date();
    await prisma.$transaction([
      ...(phoneChanged ? [
        prisma.agentExternalIdentity.updateMany({
          where: { channelConnectionId: connection.id, status: { not: "REVOKED" } },
          data: { status: "REVOKED", revokedAt: now, externalUserId: null, externalChatId: null, pairingCodeHash: null, pairingExpiresAt: null },
        }),
        prisma.agentChannelPreference.updateMany({
          where: { workspaceId: member.workspaceId, channel: "WHATSAPP" },
          data: { enabled: false },
        }),
      ] : []),
      prisma.auditLog.create({
        data: {
          workspaceId: member.workspaceId,
          userId: session.user.id,
          action: "WHATSAPP_CLOUD_CONFIGURED",
          entityType: "AgentChannelConnection",
          entityId: connection.id,
          metadata: { phoneNumberIdHash: sha256(phone.phoneNumberId), graphVersion: phone.graphVersion, phoneChanged },
        },
      }),
    ]);

    return NextResponse.json({
      connection: {
        id: connection.id,
        displayName: phone.displayPhoneNumber,
        status: "PENDING",
        externalIdentity: phone.phoneNumberId,
      },
      webhookUrl: `${appUrl()}/api/webhooks/whatsapp/${connection.id}`,
      verifyToken: webhook.verifyToken,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível configurar o WhatsApp." }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : undefined;
    const member = await requireActiveMembership(session.user.id, workspaceId);
    await requirePermission(session.user.id, member.workspaceId, P.AGENT_MANAGE);

    const connection = await prisma.agentChannelConnection.findUnique({
      where: { workspaceId_channel_accountKey: { workspaceId: member.workspaceId, channel: "WHATSAPP", accountKey: "workspace-cloud" } },
    });
    if (!connection) return NextResponse.json({ ok: true });

    const now = new Date();
    await prisma.$transaction([
      prisma.agentExternalIdentity.updateMany({
        where: { channelConnectionId: connection.id, status: { not: "REVOKED" } },
        data: { status: "REVOKED", revokedAt: now, externalUserId: null, externalChatId: null, pairingCodeHash: null, pairingExpiresAt: null },
      }),
      prisma.agentChannelPreference.updateMany({
        where: { workspaceId: member.workspaceId, channel: "WHATSAPP" },
        data: { enabled: false },
      }),
      prisma.agentChannelConnection.update({
        where: { id: connection.id },
        data: { status: "REVOKED", secretEnc: null, webhookSecretEnc: null, revokedAt: now },
      }),
      prisma.auditLog.create({
        data: {
          workspaceId: member.workspaceId,
          userId: session.user.id,
          action: "WHATSAPP_CLOUD_DISCONNECTED",
          entityType: "AgentChannelConnection",
          entityId: connection.id,
        },
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível desconectar o WhatsApp." }, { status });
  }
}
