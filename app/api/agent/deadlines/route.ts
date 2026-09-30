import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { P, memberWithPermission } from "@/lib/authz/permissions";
import { deadlineScope } from "@/lib/authz/visibility";
import { agentViewer } from "@/lib/agent/context";
import { readMblzAgentBearer } from "@/lib/agent/token";

export async function GET(request: NextRequest) {
  try {
    const claims = readMblzAgentBearer(request, "deadlines:read");
    const baseViewer = await agentViewer(claims);
    const viewer = await memberWithPermission(claims.userId, claims.workspaceId, P.DEADLINES_VIEW);
    if (!viewer) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const requestedDays = Number(request.nextUrl.searchParams.get("days") || 14);
    const days = Math.min(30, Math.max(1, Number.isFinite(requestedDays) ? Math.floor(requestedDays) : 14));
    const now = new Date();
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const deadlines = await prisma.deadline.findMany({
      where: {
        AND: [
          deadlineScope(viewer),
          {
            status: { in: ["CONFIRMED", "IN_PROGRESS"] },
            dueAt: { gte: now, lte: until },
          },
        ],
      },
      select: {
        id: true,
        title: true,
        status: true,
        risk: true,
        dueAt: true,
        internalDueAt: true,
        matter: { select: { id: true, number: true, title: true } },
      },
      orderBy: [{ dueAt: "asc" }, { internalDueAt: "asc" }],
      take: 20,
    });

    return NextResponse.json({
      workspace: { name: baseViewer.workspace.name },
      horizonDays: days,
      deadlines,
      generatedAt: new Date().toISOString(),
    }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const status = (error as Error & { status?: number }).status
      ?? (error instanceof Error && /authorization|token|scope/i.test(error.message) ? 401 : 400);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid agent request" }, { status });
  }
}
