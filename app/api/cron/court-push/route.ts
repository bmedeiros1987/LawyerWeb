import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { DjenRateLimitError } from "@/lib/courts/djen";
import { syncMatterFromDataJud, syncMatterFromDjen, type CourtPushMatter } from "@/lib/courts/push";

const DATAJUD_BATCH_SIZE = 30;
const DJEN_BATCH_SIZE = 5;

async function rotatingBatch(size: number): Promise<CourtPushMatter[]> {
  const where = { secrecy: false, status: "ACTIVE", number: { not: null } } satisfies Prisma.MatterWhereInput;
  const total = await prisma.matter.count({ where });
  if (!total) return [];

  const take = Math.min(size, total);
  const window = Math.floor(Date.now() / (15 * 60 * 1000));
  const skip = total > take ? (window * take) % total : 0;
  const select = {
    id: true,
    workspaceId: true,
    number: true,
    court: true,
    secrecy: true,
    ownerUserId: true,
    responsibleUserId: true,
  } as const;

  const first = await prisma.matter.findMany({
    where,
    select,
    orderBy: { id: "asc" },
    skip,
    take,
  });
  if (first.length === take || skip === 0) return first;

  const remainder = await prisma.matter.findMany({
    where,
    select,
    orderBy: { id: "asc" },
    take: take - first.length,
  });
  return [...first, ...remainder];
}

async function pollDataJud(matters: CourtPushMatter[]) {
  let imported = 0;
  let notified = 0;
  let errors = 0;
  let checked = 0;

  for (let index = 0; index < matters.length; index += 5) {
    const batch = matters.slice(index, index + 5);
    const results = await Promise.all(batch.map(async matter => {
      try {
        return { result: await syncMatterFromDataJud(matter), error: false };
      } catch {
        return { result: null, error: true };
      }
    }));
    for (const item of results) {
      checked += 1;
      if (item.error || !item.result) {
        errors += 1;
        continue;
      }
      imported += item.result.imported;
      notified += item.result.notified;
    }
  }

  return { checked, imported, notified, errors };
}

async function pollDjen(matters: CourtPushMatter[]) {
  let checked = 0;
  let imported = 0;
  let notified = 0;
  let errors = 0;
  let truncated = 0;
  let rateLimited = false;

  for (const matter of matters) {
    try {
      const result = await syncMatterFromDjen(matter);
      checked += 1;
      imported += result.imported;
      notified += result.notified;
      if (result.truncated) truncated += 1;
    } catch (error) {
      if (error instanceof DjenRateLimitError) {
        rateLimited = true;
        break;
      }
      checked += 1;
      errors += 1;
    }
  }

  return { checked, imported, notified, errors, truncated, rateLimited };
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [datajudMatters, djenMatters] = await Promise.all([
    rotatingBatch(DATAJUD_BATCH_SIZE),
    rotatingBatch(DJEN_BATCH_SIZE),
  ]);
  const [datajud, djen] = await Promise.all([
    pollDataJud(datajudMatters),
    pollDjen(djenMatters),
  ]);

  return NextResponse.json({
    ok: true,
    sources: ["CNJ_DATAJUD_PUBLIC", "CNJ_DJEN_PUBLIC"],
    datajud,
    djen,
    deadlineWrites: 0,
    externalActions: 0,
  });
}
