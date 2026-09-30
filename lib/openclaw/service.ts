import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { buildAgentContext } from "@/lib/openclaw/context";
import { askOpenClaw } from "@/lib/openclaw/client";
import type { Viewer } from "@/lib/authz/visibility";

const BASE_INSTRUCTIONS = `
Você é o MBLZ Agent, assistente jurídico operacional do MBLZ Legal OS.
Use somente o contexto autorizado fornecido pelo MBLZ e deixe claro quando algo não estiver no contexto.
Nunca trate uma data sugerida como prazo legal confirmado.
Nunca confirme prazo fatal, dê ciência em comunicação judicial, protocole peça, assine documento, exclua registro ou envie mensagem/e-mail externo sem confirmação humana explícita no MBLZ.
Você pode resumir, comparar, explicar, organizar, sugerir próximos passos e preparar rascunhos.
Não invente conteúdo de processo, cliente, contrato, tribunal, norma ou documento.
Quando responder sobre um item do contexto MBLZ, identifique o item pelo título/número disponível.
`.trim();

export async function ensureAgentProfile(workspaceId: string, userId: string) {
  return prisma.agentProfile.upsert({
    where: { workspaceId_userId: { workspaceId, userId } },
    create: {
      workspaceId,
      userId,
      provider: "OPENCLAW",
      agentId: process.env.OPENCLAW_AGENT_ID?.trim() || "mblz",
      displayName: "MBLZ Agent",
      enabled: true,
      policy: {
        externalSend: "HUMAN_APPROVAL_REQUIRED",
        legalDeadlineConfirmation: "HUMAN_ONLY",
        destructiveActions: "DENIED",
      },
    },
    update: {},
  });
}

export async function runMblzAgent(input: {
  viewer: Viewer;
  message: string;
  channel?: "WEB" | "EMAIL" | "WHATSAPP" | "TELEGRAM";
}) {
  const profile = await ensureAgentProfile(input.viewer.workspaceId, input.viewer.userId);
  if (!profile.enabled) throw new Error("MBLZ Agent is disabled for this user");

  const context = await buildAgentContext(input.viewer);
  const idempotencyKey = crypto.randomUUID();
  const inputHash = crypto.createHash("sha256").update(input.message).digest("hex");
  const channel = input.channel ?? "WEB";

  const run = await prisma.agentRun.create({
    data: {
      workspaceId: input.viewer.workspaceId,
      userId: input.viewer.userId,
      agentProfileId: profile.id,
      channel,
      requestType: "CHAT",
      status: "RUNNING",
      idempotencyKey,
      inputHash,
    },
  });

  const instructions = `${BASE_INSTRUCTIONS}

CONTEXTO CONFIÁVEL DO MBLZ (JSON):
${JSON.stringify(context)}`;

  try {
    const result = await askOpenClaw({
      workspaceId: input.viewer.workspaceId,
      userId: input.viewer.userId,
      channel,
      message: input.message,
      instructions,
    });

    const sessionKeyHash = crypto.createHash("sha256").update(result.sessionKey).digest("hex");
    await prisma.$transaction([
      prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: "COMPLETED",
          providerRunId: result.responseId,
          sessionKeyHash,
          completedAt: new Date(),
          metadata: { responseStatus: result.status, outputChars: result.text.length },
        },
      }),
      prisma.activityLog.create({
        data: {
          workspaceId: input.viewer.workspaceId,
          userId: input.viewer.userId,
          type: "AGENT_RUN_COMPLETED",
          entityType: "AgentRun",
          entityId: run.id,
          summary: "MBLZ Agent respondeu a uma solicitação",
          source: "OPENCLAW",
          metadata: { channel, outputChars: result.text.length },
        },
      }),
    ]);
    return { runId: run.id, reply: result.text };
  } catch (error) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: error instanceof Error ? error.message.slice(0, 240) : "OPENCLAW_ERROR",
      },
    }).catch(() => undefined);
    throw error;
  }
}
