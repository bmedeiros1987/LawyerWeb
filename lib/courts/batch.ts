import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { CourtPushMatter } from "@/lib/courts/push";

/** Length of one rotation slot. The scheduler is expected to call the cron endpoint about once per slot. */
export const COURT_POLL_SLOT_MS = 15 * 60 * 1000;

const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949;

/**
 * Start offset of the batch for the slot that contains `nowMs`.
 *
 * The previous formula, `(slot * take) % total`, only visits every matter if the scheduler runs exactly once per slot:
 * with an hourly scheduler and 120 matters / batch of 30 the offset is always 0, so matters 31..120 were never polled.
 * A golden-ratio (low-discrepancy) offset is stateless and spreads successive runs over the whole list whatever the
 * scheduler cadence, so no matter is starved (three-gap theorem: any step that is not a multiple of the slot still
 * equidistributes). It needs no migration or stored cursor.
 */
export function rotationOffset(total: number, take: number, nowMs: number) {
  if (total <= take) return 0;
  const slot = Math.floor(nowMs / COURT_POLL_SLOT_MS);
  return Math.floor(((slot * GOLDEN_RATIO_CONJUGATE) % 1) * total);
}

const matterSelect = {
  id: true,
  workspaceId: true,
  number: true,
  court: true,
  secrecy: true,
  ownerUserId: true,
  responsibleUserId: true,
} as const;

/** Eligible = public, active, has a CNJ number. Secret matters are excluded before any external query. */
export async function rotatingBatch(size: number, nowMs = Date.now()): Promise<CourtPushMatter[]> {
  const where = { secrecy: false, status: "ACTIVE", number: { not: null } } satisfies Prisma.MatterWhereInput;
  const total = await prisma.matter.count({ where });
  if (!total) return [];

  const take = Math.min(size, total);
  const skip = rotationOffset(total, take, nowMs);

  const first = await prisma.matter.findMany({ where, select: matterSelect, orderBy: { id: "asc" }, skip, take });
  if (first.length === take || skip === 0) return first;

  const remainder = await prisma.matter.findMany({ where, select: matterSelect, orderBy: { id: "asc" }, take: take - first.length });
  return [...first, ...remainder];
}
