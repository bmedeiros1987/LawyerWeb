import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";
import { matterScope } from "@/lib/authz/visibility";
import { requireActiveMembership } from "@/lib/workspace/context";
import { DjenRateLimitError } from "@/lib/courts/djen";
import { addPushDelivery, emptyPushDelivery, syncMatterFromDataJud, syncMatterFromDjen, type CourtPushMatter } from "@/lib/courts/push";

const DATAJUD_MANUAL_LIMIT = 20;
const DJEN_MANUAL_LIMIT = 5;

async function syncDataJudBatch(matters: CourtPushMatter[]) {
  let imported = 0;
  let inAppNotified = 0;
  let push = emptyPushDelivery();
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
      inAppNotified += result.inAppNotified;
      push = addPushDelivery(push, result.push);
    }
  }

  return { imported, inAppNotified, push, errors };
}

async function syncDjenBatch(matters: CourtPushMatter[]) {
  let imported = 0;
  let inAppNotified = 0;
  let push = emptyPushDelivery();
  let errors = 0;
  let truncated = 0;
  let rateLimited = false;

  // DJEN is intentionally sequential and small: the public API rate-limits by IP.
  for (const matter of matters.slice(0, DJEN_MANUAL_LIMIT)) {
    try {
      const result = await syncMatterFromDjen(matter);
      imported += result.imported;
      inAppNotified += result.inAppNotified;
      push = addPushDelivery(push, result.push);
      if (result.truncated) truncated += 1;
    } catch (error) {
      if (error instanceof DjenRateLimitError) {
        rateLimited = true;
        break;
      }
      errors += 1;
    }
  }

  return { imported, inAppNotified, push, errors, truncated, rateLimited };
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
      take: DATAJUD_MANUAL_LIMIT,
    });

    const [datajud, djen] = await Promise.all([
      syncDataJudBatch(matters),
      syncDjenBatch(matters),
    ]);
    const target = new URL("/app/integrations", request.url);
    target.searchParams.set("courtPush", String(datajud.imported + djen.imported));
    target.searchParams.set("courtDataJud", String(datajud.imported));
    target.searchParams.set("courtDjen", String(djen.imported));
    if (datajud.errors + djen.errors) target.searchParams.set("courtErrors", String(datajud.errors + djen.errors));
    if (djen.rateLimited) target.searchParams.set("courtDjenRateLimited", "1");
    if (djen.truncated) target.searchParams.set("courtDjenTruncated", String(djen.truncated));
    return NextResponse.redirect(target, 303);
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status });
  }
}
