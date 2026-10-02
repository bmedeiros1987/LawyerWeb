import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Production ingestion function, in-memory transactional persistence, synthetic
// CNJ responses and push only. There is no PostgreSQL or network in this suite.
const state = vi.hoisted(() => ({ rows: [] as any[], notes: [] as any[], responses: new Map<string, any[]>(),
  failAt: 0, creates: 0, tail: Promise.resolve() as Promise<unknown> }));
const db = vi.hoisted(() => {
  const matches = (row: any, where: any) => Object.entries(where ?? {}).every(([key, value]) => row[key] === value);
  const comm = {
    findMany: vi.fn(async ({ where }: any) => structuredClone(state.rows.filter(row => matches(row, where)))),
    findUnique: vi.fn(async ({ where }: any) => state.rows.find(row => matches(row, where.workspaceId_source_externalId)) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const row = state.rows.find(row => matches(row, where.workspaceId_source_externalId));
      if (!row) throw new Error("missing communication"); return row;
    }),
    createMany: vi.fn(async ({ data }: any) => {
      state.creates++;
      if (state.failAt && state.creates === state.failAt) throw new Error("simulated transaction interruption");
      const row = data[0];
      if (state.rows.some(r => r.workspaceId === row.workspaceId && r.source === row.source && r.externalId === row.externalId)) return { count: 0 };
      state.rows.push(structuredClone({ ...row, id: `row-${state.rows.length}` })); return { count: 1 };
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const rows = state.rows.filter(row => matches(row, where)); for (const row of rows) Object.assign(row, structuredClone(data));
      return { count: rows.length };
    }),
    count: vi.fn(async ({ where }: any) => state.rows.filter(row => matches(row, where)).length),
  };
  const mock: any = { courtCommunication: comm, userNotification: { createMany: vi.fn(async ({ data }: any) => { state.notes.push(...structuredClone(data)); return { count: data.length }; }) },
    $executeRaw: vi.fn(async () => 1), deadline: { create: vi.fn() }, matterMovement: { create: vi.fn() } };
  mock.$transaction = async (fn: any) => {
    const run = state.tail.then(async () => {
      const before = structuredClone({ rows: state.rows, notes: state.notes });
      try { return await fn(mock); } catch (error) { state.rows = before.rows; state.notes = before.notes; throw error; }
    });
    state.tail = run.catch(() => {}); return run;
  };
  return mock;
});
const access = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/authz/permissions", () => ({ canAccessMatter: access, P: { MATTERS_VIEW: "matters.view" } }));
vi.mock("@/lib/push/webpush", () => ({ sendPushToUser: push }));
import { syncMatterFromDataJud } from "@/lib/courts/push";

const matter = { id: "matter-a", workspaceId: "office-a", number: "0000000-00.2026.8.07.0000", court: "TJDFT", secrecy: false, ownerUserId: "owner-a", responsibleUserId: null };
const movement = (n: number, time = n) => ({ codigo: n, nome: `Synthetic movement ${n}`, dataHora: new Date(Date.UTC(2026, 0, 1, 0, time)).toISOString() });
const response = (items: any[]) => state.responses.set(matter.number.replace(/\D/g, ""), items);
const codes = () => state.rows.map(r => r.payload.movement.codigo).sort((a, b) => a - b);
beforeEach(() => {
  state.rows = []; state.notes = []; state.responses.clear(); state.creates = 0; state.failAt = 0; state.tail = Promise.resolve();
  vi.clearAllMocks(); access.mockResolvedValue(true); push.mockResolvedValue({ sent: 1, attempted: 1, failed: 0, removed: 0, skipped: false });
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    const number = JSON.parse(String(init.body)).query.match.numeroProcesso;
    return new Response(JSON.stringify({ hits: { hits: [{ _source: { id: "synthetic-process", movimentos: state.responses.get(number) ?? [] } }] } }));
  }));
});
afterEach(() => {
  expect(db.deadline.create).not.toHaveBeenCalled(); expect(db.matterMovement.create).not.toHaveBeenCalled();
  expect(state.rows.every(row => row.requiresAction === false && row.status === "NEW")).toBe(true);
  vi.unstubAllGlobals();
});

describe("DataJud loss regressions (review reproductions corrected)", () => {
  it("imports 0, then 10, then late 5 by identity, not max occurrence time", async () => {
    response([movement(0)]); await syncMatterFromDataJud(matter);
    response([movement(0), movement(10)]); expect((await syncMatterFromDataJud(matter)).imported).toBe(1);
    response([movement(0), movement(5), movement(10)]); expect((await syncMatterFromDataJud(matter)).imported).toBe(1);
    expect(codes()).toEqual([0, 5, 10]); expect(state.notes).toHaveLength(3);
    expect((await syncMatterFromDataJud(matter)).imported).toBe(0); expect(state.notes).toHaveLength(3);
  });
  it("drains 51 new movements across polls without losing the overflow", async () => {
    response([movement(0)]); await syncMatterFromDataJud(matter);
    response(Array.from({ length: 52 }, (_, n) => movement(n)));
    const first = await syncMatterFromDataJud(matter);
    expect(first.imported).toBe(50);
    const second = await syncMatterFromDataJud(matter);
    expect(second.imported).toBe(1); // the old implementation returns 0 here and permanently loses one item
    expect(first.truncated).toBe(true); expect(second.truncated).toBe(false);
    expect((await syncMatterFromDataJud(matter)).imported).toBe(0);
    expect(codes()).toEqual(Array.from({ length: 52 }, (_, n) => n)); expect(state.notes).toHaveLength(52);
  });
  it("initial historical identities survive reentry, order changes and disappearance, but not a late unseen identity", async () => {
    response([movement(0), movement(5), movement(10)]); await syncMatterFromDataJud(matter);
    expect(codes()).toEqual([10]);
    vi.resetModules(); const { syncMatterFromDataJud: reentered } = await import("@/lib/courts/push");
    response([movement(10)]); expect((await reentered(matter)).imported).toBe(0);
    response([movement(5), movement(10), movement(0), movement(3), movement(3)]);
    expect((await reentered(matter)).imported).toBe(1); expect(codes()).toEqual([3, 10]); expect(state.notes).toHaveLength(2);
  });
  it("never floods the initial history even when it exceeds 50 entries", async () => {
    response(Array.from({ length: 125 }, (_, n) => movement(n)));
    expect((await syncMatterFromDataJud(matter)).imported).toBe(1);
    for (let n = 0; n < 3; n++) expect((await syncMatterFromDataJud(matter)).imported).toBe(0);
    expect(codes()).toEqual([124]); expect(push).toHaveBeenCalledTimes(1);
  });
  it("interrupted later batch rolls back and reentry recovers every pending identity once", async () => {
    response([movement(0)]); await syncMatterFromDataJud(matter);
    response(Array.from({ length: 122 }, (_, n) => movement(n)));
    expect((await syncMatterFromDataJud(matter)).imported).toBe(50);
    state.creates = 0; state.failAt = 3;
    await expect(syncMatterFromDataJud(matter)).rejects.toThrow("interruption");
    expect(state.rows).toHaveLength(51); expect(state.notes).toHaveLength(51); expect(push).toHaveBeenCalledTimes(51);
    state.failAt = 0;
    response(Array.from({ length: 122 }, (_, n) => movement(121 - n)));
    expect((await syncMatterFromDataJud(matter)).imported).toBe(50);
    expect((await syncMatterFromDataJud(matter)).imported).toBe(21);
    expect((await syncMatterFromDataJud(matter)).imported).toBe(0);
    expect(new Set(codes()).size).toBe(122); expect(state.notes).toHaveLength(122);
  });
  it("interrupted bootstrap leaves no partial history marker and retries only the latest", async () => {
    response([movement(0), movement(5), movement(10)]); state.failAt = 1;
    await expect(syncMatterFromDataJud(matter)).rejects.toThrow(); expect(state.rows).toHaveLength(0); expect(state.notes).toHaveLength(0);
    state.failAt = 0; expect((await syncMatterFromDataJud(matter)).imported).toBe(1);
    expect((await syncMatterFromDataJud(matter)).imported).toBe(0); expect(codes()).toEqual([10]);
  });
  it("recovers legacy unseen evidence quietly, drains overflow, then notifies only newly observed identities", async () => {
    response([movement(0)]); await syncMatterFromDataJud(matter); delete state.rows[0].payload.datajudObservation;
    response(Array.from({ length: 102 }, (_, n) => movement(n)));
    expect(await syncMatterFromDataJud(matter)).toMatchObject({ imported: 50, inAppNotified: 0 });
    response([...Array.from({ length: 102 }, (_, n) => movement(n)), movement(500, 2)]);
    expect(await syncMatterFromDataJud(matter)).toMatchObject({ imported: 50, inAppNotified: 1 });
    expect(await syncMatterFromDataJud(matter)).toMatchObject({ imported: 2, inAppNotified: 0 });
    expect((await syncMatterFromDataJud(matter)).imported).toBe(0); expect(state.notes).toHaveLength(2); expect(state.rows).toHaveLength(103);
  });
  it("serializes overlapping bootstrap snapshots without treating a later arrival as initial history", async () => {
    const queue = [[movement(0), movement(10)], [movement(0), movement(5), movement(10)]];
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ hits: { hits: [{ _source: { id: "synthetic-process", movimentos: queue.shift() } }] } })));
    await Promise.all([syncMatterFromDataJud(matter), syncMatterFromDataJud(matter)]);
    expect(codes()).toEqual([5, 10]); expect(state.notes).toHaveLength(2);
    expect(db.$executeRaw.mock.calls.every((call: any[]) => call[1] === JSON.stringify([matter.workspaceId, matter.id, "DATAJUD"]))).toBe(true);
  });
  it("keeps initial history and identities scoped to tenant/matter and never fetches secret matters", async () => {
    response([movement(0), movement(10)]); await syncMatterFromDataJud(matter);
    const other = { ...matter, id: "matter-b", workspaceId: "office-b", ownerUserId: "owner-b" };
    response([movement(0)]); await syncMatterFromDataJud(other);
    response([movement(0), movement(5), movement(10)]);
    await syncMatterFromDataJud(matter); await syncMatterFromDataJud(other);
    expect(state.rows.filter(r => r.workspaceId === "office-a").map(r => r.payload.movement.codigo).sort()).toEqual([10, 5]);
    expect(state.rows.filter(r => r.workspaceId === "office-b")).toHaveLength(3);
    expect(state.notes.every(n => n.userId === (n.workspaceId === "office-a" ? "owner-a" : "owner-b"))).toBe(true);
    vi.mocked(fetch).mockClear(); expect((await syncMatterFromDataJud({ ...matter, secrecy: true })).skipped).toBe("secret-matter"); expect(fetch).not.toHaveBeenCalled();
  });
  it("does not discard equal, missing or invalid timestamps on new identities", async () => {
    response([movement(10)]); await syncMatterFromDataJud(matter);
    response([movement(10), movement(11, 10), { codigo: 12, nome: "No occurrence date" }, { codigo: 13, nome: "Invalid date", dataHora: "invalid" }]);
    expect((await syncMatterFromDataJud(matter)).imported).toBe(3); expect(codes()).toEqual([10, 11, 12, 13]);
  });
});
