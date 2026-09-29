import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { P, requirePermission } from "@/lib/authz/permissions";
import { completeDeadline } from "@/lib/deadlines/service";

const input = z.object({ workspaceId: z.string().min(1) });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await context.params;
    const parsed = input.parse(await request.json());
    await requirePermission(session.user.id, parsed.workspaceId, P.DEADLINES_COMPLETE);
    const deadline = await completeDeadline({ deadlineId: id, workspaceId: parsed.workspaceId, userId: session.user.id });
    return NextResponse.json({ deadline });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status });
  }
}
