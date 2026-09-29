import { google } from "googleapis";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { appUrl, createGoogleOAuthClient, gmailRedirectUri } from "@/lib/google/oauth";
import { initialGmailSync, startGmailWatch } from "@/lib/google/gmail";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(`${appUrl()}/login`);

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expected = request.cookies.get("mblz_google_gmail_oauth_state")?.value;
  const workspaceId = request.cookies.get("mblz_google_gmail_workspace")?.value;
  if (!code || !state || !expected || state !== expected || !workspaceId) {
    return NextResponse.redirect(`${appUrl()}/app/integrations?gmail=state_error`);
  }

  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: session.user.id } } });
  if (!member || member.status !== "ACTIVE") return NextResponse.redirect(`${appUrl()}/app/integrations?gmail=forbidden`);

  const oauth = createGoogleOAuthClient(gmailRedirectUri());
  const { tokens } = await oauth.getToken(code);
  oauth.setCredentials(tokens);
  const profile = await google.oauth2({ version: "v2", auth: oauth }).userinfo.get();
  if (!profile.data.email) return NextResponse.redirect(`${appUrl()}/app/integrations?gmail=no_email`);

  const current = await prisma.googleGmailConnection.findUnique({ where: { workspaceId_userId: { workspaceId, userId: session.user.id } } });
  const connection = await prisma.googleGmailConnection.upsert({
    where: { workspaceId_userId: { workspaceId, userId: session.user.id } },
    create: {
      workspaceId,
      userId: session.user.id,
      googleEmail: profile.data.email,
      accessTokenEnc: tokens.access_token ? encryptSecret(tokens.access_token) : null,
      refreshTokenEnc: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scope: tokens.scope ?? null,
    },
    update: {
      googleEmail: profile.data.email,
      accessTokenEnc: tokens.access_token ? encryptSecret(tokens.access_token) : current?.accessTokenEnc ?? null,
      refreshTokenEnc: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : current?.refreshTokenEnc ?? null,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : current?.expiresAt ?? null,
      scope: tokens.scope ?? current?.scope ?? null,
    },
  });

  await initialGmailSync(connection.id, 50);
  const watch = await startGmailWatch(connection.id);

  await prisma.activityLog.create({
    data: {
      workspaceId,
      userId: session.user.id,
      type: "GMAIL_CONNECTED",
      entityType: "GoogleGmailConnection",
      entityId: connection.id,
      summary: "Gmail conectado à Caixa Jurídica",
      metadata: { googleEmail: profile.data.email, watchConfigured: !watch.skipped },
    },
  });

  const response = NextResponse.redirect(`${appUrl()}/app/integrations?gmail=${watch.skipped ? "connected_needs_pubsub" : "connected"}`);
  response.cookies.delete("mblz_google_gmail_oauth_state");
  response.cookies.delete("mblz_google_gmail_workspace");
  return response;
}
