import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sha256 } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { respondWithAgent } from "@/lib/agent/service";
import {
  extractWhatsAppMessages,
  sendWhatsAppMessage,
  verifyWhatsAppSignature,
  whatsappConfig,
  whatsappSecrets,
} from "@/lib/agent/whatsapp";

function safeEqual(a: string, b: string) {
  const ah = crypto.createHash("sha256").update(a).digest();
  const bh = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const connection = await prisma.agentChannelConnection.findFirst({
    where: { id, channel: "WHATSAPP", status: { in: ["PENDING", "CONNECTED"] } },
  });
  if (!connection) return new NextResponse("Not found", { status: 404 });

  let verifyToken: string;
  try {
    verifyToken = whatsappSecrets(connection).verifyToken;
  } catch {
    return new NextResponse("Unavailable", { status: 503 });
  }

  const mode = request.nextUrl.searchParams.get("hub.mode") ?? "";
  const received = request.nextUrl.searchParams.get("hub.verify_token") ?? "";
  const challenge = request.nextUrl.searchParams.get("hub.challenge") ?? "";
  if (mode !== "subscribe" || !received || !challenge || !safeEqual(received, verifyToken)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  if (connection.status !== "CONNECTED") {
    const now = new Date();
    await prisma.$transaction([
      prisma.agentChannelConnection.update({
        where: { id: connection.id },
        data: { status: "CONNECTED", connectedAt: now, revokedAt: null },
      }),
      prisma.auditLog.create({
        data: {
          workspaceId: connection.workspaceId,
          userId: null,
          action: "WHATSAPP_WEBHOOK_VERIFIED",
          entityType: "AgentChannelConnection",
          entityId: connection.id,
        },
      }),
    ]);
  }

  return new NextResponse(challenge, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const connection = await prisma.agentChannelConnection.findFirst({
    where: { id, channel: "WHATSAPP", status: "CONNECTED" },
  });
  if (!connection) return new NextResponse("Not found", { status: 404 });

  let secrets: ReturnType<typeof whatsappSecrets>;
  let config: ReturnType<typeof whatsappConfig>;
  try {
    secrets = whatsappSecrets(connection);
    config = whatsappConfig(connection);
  } catch {
    return new NextResponse("Unavailable", { status: 503 });
  }

  const rawBody = await request.text();
  if (!verifyWhatsAppSignature(rawBody, request.headers.get("x-hub-signature-256"), secrets.appSecret)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }

  const messages = extractWhatsAppMessages(payload);
  if (!messages.length) return NextResponse.json({ ok: true });

  for (const message of messages) {
    if (message.phoneNumberId && message.phoneNumberId !== config.phoneNumberId) continue;

    let event;
    try {
      event = await prisma.agentChannelEvent.create({
        data: {
          workspaceId: connection.workspaceId,
          channelConnectionId: connection.id,
          channel: "WHATSAPP",
          externalEventId: message.eventId,
          status: "RECEIVED",
          metadata: {
            type: message.type,
            senderHash: sha256(message.waId),
            textHash: message.text ? sha256(message.text) : null,
          },
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") continue;
      continue;
    }

    try {
      if (message.type !== "text" || !message.text) {
        await prisma.agentChannelEvent.update({
          where: { id: event.id },
          data: { status: "IGNORED", processedAt: new Date() },
        });
        continue;
      }

      const pairing = message.text.match(/^MBLZ\s+([A-Za-z0-9_-]{8,80})$/i);
      if (pairing) {
        const identity = await prisma.agentExternalIdentity.findFirst({
          where: {
            channelConnectionId: connection.id,
            channel: "WHATSAPP",
            status: "PENDING",
            pairingCodeHash: sha256(pairing[1]),
            pairingExpiresAt: { gt: new Date() },
          },
        });

        if (!identity) {
          await sendWhatsAppMessage(connection, message.waId, "Esse pareamento expirou ou já foi utilizado. Gere um novo link dentro do MBLZ.");
          await prisma.agentChannelEvent.update({
            where: { id: event.id },
            data: { status: "PROCESSED", processedAt: new Date() },
          });
          continue;
        }

        const other = await prisma.agentExternalIdentity.findFirst({
          where: {
            channelConnectionId: connection.id,
            externalUserId: message.waId,
            status: "VERIFIED",
            id: { not: identity.id },
          },
        });
        if (other) {
          await sendWhatsAppMessage(connection, message.waId, "Este WhatsApp já está vinculado a outro usuário deste workspace. Remova o vínculo anterior pelo MBLZ.");
          await prisma.agentChannelEvent.update({
            where: { id: event.id },
            data: { status: "REJECTED", processedAt: new Date(), error: "external identity already paired" },
          });
          continue;
        }

        const now = new Date();
        await prisma.$transaction([
          prisma.agentExternalIdentity.update({
            where: { id: identity.id },
            data: {
              externalUserId: message.waId,
              externalChatId: message.waId,
              displayName: message.displayName ?? "WhatsApp",
              status: "VERIFIED",
              verifiedAt: now,
              revokedAt: null,
              pairingCodeHash: null,
              pairingExpiresAt: null,
            },
          }),
          prisma.agentChannelPreference.upsert({
            where: {
              workspaceId_userId_channel: {
                workspaceId: connection.workspaceId,
                userId: identity.userId,
                channel: "WHATSAPP",
              },
            },
            create: {
              workspaceId: connection.workspaceId,
              userId: identity.userId,
              channel: "WHATSAPP",
              enabled: true,
              mode: "ASSIST",
            },
            update: { enabled: true, mode: "ASSIST" },
          }),
          prisma.agentChannelEvent.update({
            where: { id: event.id },
            data: { userId: identity.userId, status: "PROCESSED", processedAt: now },
          }),
          prisma.auditLog.create({
            data: {
              workspaceId: connection.workspaceId,
              userId: identity.userId,
              action: "WHATSAPP_USER_PAIRED",
              entityType: "AgentExternalIdentity",
              entityId: identity.id,
              metadata: { waIdHash: sha256(message.waId) },
            },
          }),
        ]);

        await sendWhatsAppMessage(
          connection,
          message.waId,
          "WhatsApp conectado ao MBLZ. Este canal responde somente à sua conta pareada e respeita as permissões do seu usuário no workspace.",
        );
        continue;
      }

      const identity = await prisma.agentExternalIdentity.findFirst({
        where: {
          channelConnectionId: connection.id,
          channel: "WHATSAPP",
          status: "VERIFIED",
          externalUserId: message.waId,
          externalChatId: message.waId,
        },
      });
      if (!identity) {
        await sendWhatsAppMessage(connection, message.waId, "Este WhatsApp ainda não está vinculado ao MBLZ. Gere seu link de pareamento em Integrações → MBLZ Agent.");
        await prisma.agentChannelEvent.update({
          where: { id: event.id },
          data: { status: "REJECTED", processedAt: new Date(), error: "unpaired identity" },
        });
        continue;
      }

      const preference = await prisma.agentChannelPreference.findUnique({
        where: {
          workspaceId_userId_channel: {
            workspaceId: connection.workspaceId,
            userId: identity.userId,
            channel: "WHATSAPP",
          },
        },
      });
      if (!preference?.enabled) {
        await sendWhatsAppMessage(connection, message.waId, "O canal WhatsApp do agente está desativado no MBLZ. Reative em Integrações.");
        await prisma.agentChannelEvent.update({
          where: { id: event.id },
          data: { userId: identity.userId, status: "REJECTED", processedAt: new Date(), error: "channel disabled" },
        });
        continue;
      }

      const answer = await respondWithAgent({
        userId: identity.userId,
        workspaceId: connection.workspaceId,
        channel: "WHATSAPP",
        threadId: `whatsapp:${message.waId}`,
        message: message.text,
      });
      await sendWhatsAppMessage(connection, message.waId, answer.text);
      await prisma.agentChannelEvent.update({
        where: { id: event.id },
        data: { userId: identity.userId, status: "PROCESSED", processedAt: new Date() },
      });
    } catch (error) {
      const failure = error instanceof Error ? error.message : "whatsapp processing failed";
      await prisma.agentChannelEvent.update({
        where: { id: event.id },
        data: { status: "FAILED", processedAt: new Date(), error: failure.slice(0, 2000) },
      }).catch(() => null);
      await sendWhatsAppMessage(connection, message.waId, "O agente MBLZ está temporariamente indisponível. Tente novamente em instantes.").catch(() => null);
    }
  }

  return NextResponse.json({ ok: true });
}
