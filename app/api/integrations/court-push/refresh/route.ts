import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";
import { matterScope } from "@/lib/authz/visibility";
import { requireActiveMembership } from "@/lib/workspace/context";
import { syncMatterFromDataJud, type CourtPushMatter } from "@/lib/courts/push";

async function syncBatch(matters: CourtPushMatter[]) {
  let imported = 0;
  let notified = 0;
  let errors = 0;

  for (let index = 0; index < matters.length; index += 5) {
    const batch = matters.slice(index, index + 5);
    const results = await Promise.all(batch.map(async matter => {
      try {
        return await syncMatterFromDataJud(matter);
      } catch {
        errors += 1;
        return null;
      }
    }));
    for (const result of results) {
      if (!result) continue;
      imported += result.imported;
      notified += result.notified;
    }
  }

  return { imported, notified, errors };
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const member = await requireActiveMembership(session.user.id);
    const viewer = await requirePermission(session.user.id, member.workspaceId, P.MATTERS_VIEW);
    const matters = await prisma.matter.findMany({
      where: {
        AND: [
          matterScope(viewer),
          { secrecy: false, status: "ACTIVE", number: { not: null } },
        ],
      },
      select: {
        id: true,
        workspaceId: true,
        number: true,
        court: true,
        secrecy: true,
        ownerUserId: true,
        responsibleUserId: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 75,
    });

    const result = await syncBatch(matters);
    const target = new URL("/app/integrations", request.url);
    target.searchParams.set("courtPush", String(result.imported));
    if (result.errors) target.searchParams.set("courtErrors", String(result.errors));
    return NextResponse.redirect(target, 303);
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status });
  }
}
