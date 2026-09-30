import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";
import { openClawConfigured } from "@/lib/openclaw/client";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getActiveMembership(session.user.id);
  if (!member) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  if (!await memberWithPermission(session.user.id, member.workspaceId, P.AGENT_USE)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [profile, channels, gmail] = await Promise.all([
    prisma.agentProfile.findUnique({ where: { workspaceId_userId: { workspaceId: member.workspaceId, userId: session.user.id } } }),
    prisma.agentChannelConnection.findMany({
      where: { workspaceId: member.workspaceId, userId: session.user.id },
      select: { id: true, channel: true, status: true, accountId: true, displayName: true, maskedAddress: true, lastHealthAt: true, lastError: true },
      orderBy: { channel: "asc" },
    }),
    prisma.googleGmailConnection.findUnique({
      where: { workspaceId_userId: { workspaceId: member.workspaceId, userId: session.user.id } },
      select: { googleEmail: true, watchExpiresAt: true },
    }),
  ]);

  return NextResponse.json({
    configured: openClawConfigured(),
    enabled: profile?.enabled ?? true,
    profileId: profile?.id ?? null,
    channels,
    email: gmail ? { provider: "GMAIL", address: gmail.googleEmail, connected: true, watchExpiresAt: gmail.watchExpiresAt } : { provider: "GMAIL", connected: false },
  });
}
