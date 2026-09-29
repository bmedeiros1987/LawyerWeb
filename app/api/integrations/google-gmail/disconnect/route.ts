import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { createGoogleOAuthClient, gmailRedirectUri } from "@/lib/google/oauth";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : null;
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });

  const connection = await prisma.googleGmailConnection.findUnique({ where: { workspaceId_userId: { workspaceId, userId: session.user.id } } });
  if (connection) {
    const token = connection.refreshTokenEnc ? decryptSecret(connection.refreshTokenEnc) : connection.accessTokenEnc ? decryptSecret(connection.accessTokenEnc) : null;
    if (token) {
      try { await createGoogleOAuthClient(gmailRedirectUri()).revokeToken(token); } catch {}
    }
    await prisma.googleGmailConnection.delete({ where: { id: connection.id } });
    await prisma.activityLog.create({
      data: { workspaceId, userId: session.user.id, type: "GMAIL_DISCONNECTED", entityType: "GoogleGmailConnection", entityId: connection.id, summary: "Gmail desconectado" },
    });
  }
  return NextResponse.json({ ok: true });
}
