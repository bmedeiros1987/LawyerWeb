import { describe, expect, it } from "vitest";
import { COURT_POLL_SLOT_MS, rotationOffset } from "@/lib/courts/batch";

// What the PR shipped: only correct if the scheduler fires exactly once per 15-minute slot.
const previousOffset = (total: number, take: number, now: number) => {
  const slot = Math.floor(now / COURT_POLL_SLOT_MS);
  return total > take ? (slot * take) % total : 0;
};

/** Which matter indexes (0..total-1) get polled across `runs` scheduler executions spaced `everyMinutes` apart. */
function coverage(offsetFn: (total: number, take: number, now: number) => number, total: number, take: number, everyMinutes: number, runs: number) {
  const seen = new Set<number>();
  const start = Date.UTC(2026, 9, 1, 12, 0, 0);
  for (let run = 0; run < runs; run += 1) {
    const offset = offsetFn(total, take, start + run * everyMinutes * 60_000);
    for (let i = 0; i < take; i += 1) seen.add((offset + i) % total);
  }
  return seen.size;
}

describe("court polling rotation covers every matter whatever the scheduler cadence", () => {
  it("documents the defect of the previous formula: an hourly scheduler never reaches matters 31..120", () => {
    expect(coverage(previousOffset, 120, 30, 15, 400)).toBe(120);   // only correct at the assumed 15-minute cadence
    expect(coverage(previousOffset, 120, 30, 60, 400)).toBe(30);    // starvation: the same 30 matters forever
  });

  for (const minutes of [5, 10, 15, 30, 60, 180, 360, 1440]) {
    it(`every matter is polled when the scheduler runs every ${minutes} minutes (120 matters, batch of 30)`, () => {
      expect(coverage(rotationOffset, 120, 30, minutes, 600)).toBe(120);
    });
  }

  it("covers odd sizes and the DJEN batch (batch of 5 over 53 matters) at hourly cadence", () => {
    expect(coverage(rotationOffset, 53, 5, 60, 2000)).toBe(53);
    expect(coverage(rotationOffset, 7, 5, 15, 200)).toBe(7);
  });

  it("is deterministic within a slot and always inside range", () => {
    const now = Date.UTC(2026, 9, 1, 12, 7, 0);
    expect(rotationOffset(120, 30, now)).toBe(rotationOffset(120, 30, now + 5 * 60_000));
    for (let i = 0; i < 1000; i += 1) {
      const offset = rotationOffset(97, 30, now + i * COURT_POLL_SLOT_MS);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(97);
    }
    expect(rotationOffset(10, 30, now)).toBe(0);   // whole list fits in one batch
    expect(rotationOffset(0, 30, now)).toBe(0);
  });
});
