import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { P } from "@/lib/authz/permissions";
import { allows, deadlineScope, matterScope, taskScope } from "@/lib/authz/visibility";
import { agentViewer } from "@/lib/agent/context";
import { readMblzAgentBearer } from "@/lib/agent/token";

export async function GET(request: NextRequest) {
  try {
    const claims = readMblzAgentBearer(request, "workspace:summary:read");
    const viewer = await agentViewer(claims);
    const now = new Date();
    const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [matters, upcomingDeadlines, openTasks] = await Promise.all([
      allows(viewer, P.MATTERS_VIEW)
        ? prisma.matter.count({ where: matterScope(viewer) })
        : Promise.resolve(0),
      allows(viewer, P.DEADLINES_VIEW)
        ? prisma.deadline.count({
            where: {
              AND: [
                deadlineScope(viewer),
                { status: { in: ["CONFIRMED", "IN_PROGRESS"] }, dueAt: { gte: now, lte: inSevenDays } },
              ],
            },
          })
        : Promise.resolve(0),
      allows(viewer, P.TASKS_VIEW)
        ? prisma.legalTask.count({
            where: {
              AND: [
                taskScope(viewer),
                { status: { in: ["OPEN", "IN_PROGRESS", "WAITING", "REVIEW"] } },
              ],
            },
          })
        : Promise.resolve(0),
    ]);

    return NextResponse.json({
      workspace: {
        name: viewer.workspace.name,
        timezone: viewer.workspace.timezone,
      },
      counts: {
        visibleMatters: matters,
        upcomingConfirmedDeadlines7d: upcomingDeadlines,
        visibleOpenTasks: openTasks,
      },
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
