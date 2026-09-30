import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";
import { inboxScope } from "@/lib/authz/visibility";
import { requireActiveMembership } from "@/lib/workspace/context";
import { buildEmailDraftPrompt } from "@/lib/agent/email";
import { respondWithAgent } from "@/lib/agent/service";

const input = z.object({
  workspaceId: z.string().min(1),
  demandId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  try {
    const parsed = input.parse(await request.json());
    const member = await requireActiveMembership(session.user.id, parsed.workspaceId);
    const viewer = await requirePermission(session.user.id, member.workspaceId, P.AGENT_USE);

    const [preference, gmail, demand] = await Promise.all([
      prisma.agentChannelPreference.findUnique({
        where: {
          workspaceId_userId_channel: {
            workspaceId: member.workspaceId,
            userId: session.user.id,
            channel: "EMAIL",
          },
        },
        select: { enabled: true, mode: true },
      }),
      prisma.googleGmailConnection.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: member.workspaceId,
            userId: session.user.id,
          },
        },
        select: { id: true, googleEmail: true },
      }),
      prisma.intakeDemand.findFirst({
        where: {
          id: parsed.demandId,
          source: "GMAIL",
          ...inboxScope(viewer),
        },
        include: {
          matter: { select: { number: true, title: true } },
        },
      }),
    ]);

    if (!demand) return NextResponse.json({ error: "E-mail não encontrado ou sem acesso." }, { status: 404 });
    if (!gmail) return NextResponse.json({ error: "Conecte seu Gmail antes de gerar um rascunho." }, { status: 409 });
    if (!preference?.enabled) {
      return NextResponse.json({ error: "Ative o canal E-mail no MBLZ Agent antes de gerar rascunhos." }, { status: 409 });
    }

    const matterLabel = demand.matter
      ? demand.matter.number ?? demand.matter.title
      : null;

    const response = await respondWithAgent({
      userId: session.user.id,
      workspaceId: member.workspaceId,
      channel: "EMAIL",
      threadId: demand.threadId ? `gmail:${demand.threadId}` : `gmail-message:${demand.externalId}`,
      message: buildEmailDraftPrompt({
        subject: demand.title,
        sender: demand.sender,
        recipients: demand.recipients,
        body: demand.bodyPreview,
        matterLabel,
      }),
    });

    await prisma.auditLog.create({
      data: {
        workspaceId: member.workspaceId,
        userId: session.user.id,
        action: "AGENT_EMAIL_DRAFT_GENERATED",
        entityType: "IntakeDemand",
        entityId: demand.id,
        metadata: {
          conversationId: response.conversationId,
          channel: "EMAIL",
          mode: "DRAFT",
        },
      },
    });

    return NextResponse.json(
      {
        text: response.text,
        conversationId: response.conversationId,
        mode: "DRAFT",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível gerar o rascunho." },
      { status },
    );
  }
}
