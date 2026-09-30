import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { createGoogleOAuthClient, gmailRedirectUri } from "@/lib/google/oauth";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const contentType = request.headers.get("content-type") ?? "";
  let workspaceId: string | null = null;
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : null;
  } else {
    const form = await request.formData();
    const raw = form.get("workspaceId");
    workspaceId = typeof raw === "string" ? raw : null;
  }
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });

  const connection = await prisma.googleGmailConnection.findUnique({ where: { workspaceId_userId: { workspaceId, userId: session.user.id } } });
  if (connection) {
    const token = connection.refreshTokenEnc ? decryptSecret(connection.refreshTokenEnc) : connection.accessTokenEnc ? decryptSecret(connection.accessTokenEnc) : null;
    if (token) {
      try { await createGoogleOAuthClient(gmailRedirectUri()).revokeToken(token); } catch {}
    }
    await prisma.$transaction([
      prisma.googleGmailConnection.delete({ where: { id: connection.id } }),
      prisma.agentChannelPreference.updateMany({
        where: { workspaceId, userId: session.user.id, channel: "EMAIL" },
        data: { enabled: false },
      }),
      prisma.activityLog.create({
        data: { workspaceId, userId: session.user.id, type: "GMAIL_DISCONNECTED", entityType: "GoogleGmailConnection", entityId: connection.id, summary: "Gmail desconectado" },
      }),
    ]);
  } else {
    await prisma.agentChannelPreference.updateMany({
      where: { workspaceId, userId: session.user.id, channel: "EMAIL" },
      data: { enabled: false },
    });
  }
  return NextResponse.redirect(new URL("/app/integrations?gmail=disconnected", request.url), 303);
}
