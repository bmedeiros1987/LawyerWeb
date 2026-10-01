import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { syncMatterFromDataJud, type CourtPushMatter } from "@/lib/courts/push";

const BATCH_SIZE = 60;

async function rotatingBatch(): Promise<CourtPushMatter[]> {
  const where = { secrecy: false, status: "ACTIVE", number: { not: null } } satisfies Prisma.MatterWhereInput;
  const total = await prisma.matter.count({ where });
  if (!total) return [];

  const take = Math.min(BATCH_SIZE, total);
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

export async function POST(request: NextRequest) {
  const secret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const matters = await rotatingBatch();
  let imported = 0;
  let notified = 0;
  let errors = 0;
  let checked = 0;

  for (let index = 0; index < matters.length; index += 5) {
    const batch = matters.slice(index, index + 5);
    const results = await Promise.all(batch.map(async matter => {
      try {
        const result = await syncMatterFromDataJud(matter);
        return { result, error: false };
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

  return NextResponse.json({
    ok: true,
    source: "CNJ_DATAJUD_PUBLIC",
    checked,
    imported,
    notified,
    errors,
    deadlineWrites: 0,
  });
}
