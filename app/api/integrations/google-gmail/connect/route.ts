import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { appUrl, createGoogleOAuthClient, gmailRedirectUri, GOOGLE_GMAIL_SCOPES } from "@/lib/google/oauth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(`${appUrl()}/login`);
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });

  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: session.user.id } } });
  if (!member || member.status !== "ACTIVE") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const state = crypto.randomBytes(32).toString("base64url");
  const url = createGoogleOAuthClient(gmailRedirectUri()).generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent",
    scope: GOOGLE_GMAIL_SCOPES,
    state,
    login_hint: session.user.email ?? undefined,
  });

  const response = NextResponse.redirect(url);
  const cookie = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 };
  response.cookies.set("mblz_google_gmail_oauth_state", state, cookie);
  response.cookies.set("mblz_google_gmail_workspace", workspaceId, cookie);
  return response;
}
