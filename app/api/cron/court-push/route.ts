import { NextRequest, NextResponse } from "next/server";
import { DjenRateLimitError } from "@/lib/courts/djen";
import { rotatingBatch } from "@/lib/courts/batch";
import { PUSH_DELIVERY_NOTE, addPushDelivery, emptyPushDelivery, syncMatterFromDataJud, syncMatterFromDjen, type CourtPushMatter } from "@/lib/courts/push";

const DATAJUD_BATCH_SIZE = 30;
const DJEN_BATCH_SIZE = 5;

async function pollDataJud(matters: CourtPushMatter[]) {
  let imported = 0;
  let inAppNotified = 0;
  let push = emptyPushDelivery();
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
      inAppNotified += item.result.inAppNotified;
      push = addPushDelivery(push, item.result.push);
    }
  }

  return { checked, imported, inAppNotified, push, errors };
}

async function pollDjen(matters: CourtPushMatter[]) {
  let checked = 0;
  let imported = 0;
  let inAppNotified = 0;
  let push = emptyPushDelivery();
  let errors = 0;
  let truncated = 0;
  let rateLimited = false;

  for (const matter of matters) {
    try {
      const result = await syncMatterFromDjen(matter);
      checked += 1;
      imported += result.imported;
      inAppNotified += result.inAppNotified;
      push = addPushDelivery(push, result.push);
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

  return { checked, imported, inAppNotified, push, errors, truncated, rateLimited };
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
    push: addPushDelivery(datajud.push, djen.push),
    pushNote: PUSH_DELIVERY_NOTE,
    deadlineWrites: 0,
    externalActions: 0,
  });
}
