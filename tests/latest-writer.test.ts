// The newest value always ends up stored, whatever order the network answers in.
import { describe, expect, it } from "vitest";
import { createLatestWriter } from "@/lib/ui/latest-writer";

function fakeServer() {
  let stored = 0, inFlight = 0, maxInFlight = 0;
  const pending: { value: number; finish: (ok?: boolean) => void }[] = [];
  const send = (value: number) => new Promise<number>((resolve, reject) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    pending.push({ value, finish: (ok = true) => { inFlight--; if (ok) { stored = value; resolve(value); } else reject(new Error("falhou")); } });
  });
  return { send, pending, stored: () => stored, maxInFlight: () => maxInFlight };
}
const tick = () => new Promise(r => setTimeout(r, 0));

describe("latest writer", () => {
  it("fast writes: one request at a time, intermediate values skipped, last one stored", async () => {
    const s = fakeServer(), w = createLatestWriter(s.send, 0);
    const outcomes = [1, 2, 3, 4].map(v => w.write(v));
    await tick();
    expect(s.pending.map(p => p.value)).toEqual([1]); // 2 and 3 are collapsed into 4
    s.pending[0].finish(); await tick();
    expect(s.pending.map(p => p.value)).toEqual([1, 4]);
    s.pending[1].finish();
    expect(await Promise.all(outcomes)).toEqual([{ status: "superseded" }, { status: "superseded" }, { status: "superseded" }, { status: "saved", value: 4 }]);
    expect(s.stored()).toBe(4);
    expect(s.maxInFlight()).toBe(1);
  });

  it("a write made after the previous answer arrived is sent on its own", async () => {
    const s = fakeServer(), w = createLatestWriter(s.send, 0);
    const a = w.write(1); await tick(); s.pending[0].finish();
    expect(await a).toEqual({ status: "saved", value: 1 });
    const b = w.write(2); await tick(); s.pending[1].finish();
    expect(await b).toEqual({ status: "saved", value: 2 });
  });

  it("failure of the newest write reports the last confirmed value", async () => {
    const s = fakeServer(), w = createLatestWriter(s.send, 0);
    const a = w.write(1); await tick(); s.pending[0].finish();
    await a;
    const b = w.write(2); await tick(); s.pending[1].finish(false);
    expect(await b).toMatchObject({ status: "failed", confirmed: 1 });
    expect(s.stored()).toBe(1);
  });

  it("an older failure is not reported when a newer write follows and succeeds", async () => {
    const s = fakeServer(), w = createLatestWriter(s.send, 0);
    const a = w.write(1); await tick();
    const b = w.write(2);
    s.pending[0].finish(false); await tick();
    s.pending[1].finish();
    expect(await a).toEqual({ status: "superseded" });
    expect(await b).toEqual({ status: "saved", value: 2 });
  });
});
