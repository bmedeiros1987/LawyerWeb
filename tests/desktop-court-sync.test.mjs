import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, scopeKey, syncCourt, unavailableProvider, ProviderUnavailable } from "../lib/desktop/court-sync.ts";
import { dataJudPage, djenPage } from "../lib/desktop/court-adapters.ts";

const scope = { workspaceId: "fixture-workspace", matterId: "fixture-process", source: "DATAJUD", actorUserId: "fixture-actor" };
const event = (id, occurredAt = "2026-10-01T13:00:00Z") => ({
  id, title: "Movimentação fictícia", body: "Fonte sintética para teste", occurredAt, evidence: { synthetic: true },
});
const time = () => new Date("2026-10-07T10:00:00Z");
const provider = (events, cursor = "next", complete = true) => ({
  source: "DATAJUD", async read() { return { events, cursor, complete }; },
});
// Transactional fixture only: no database, network, secrets or production adapter.
function fixture() {
  const states = new Map(), events = new Map(), notices = new Map();
  let failNotification = false, eligible = true, queue = Promise.resolve();
  const store = { transaction(selected, action) {
    const run = queue.then(async () => {
      const key = scopeKey(selected), stagedEvents = new Map(events), stagedNotices = new Map(notices);
      let stagedState = structuredClone(states.get(key) ?? initialState());
      const result = await action({
        state: stagedState, eligible: async () => eligible,
        async insert(item, identity, capturedAt) {
          if (stagedEvents.has(identity)) return { imported: 0, inAppNotified: 0 };
          stagedEvents.set(identity, { selected, item, capturedAt });
          if (item.notify === false) return { imported: 1, inAppNotified: 0 };
          if (failNotification) throw new Error("synthetic notification failure");
          stagedNotices.set(identity, { workspaceId: selected.workspaceId, matterId: selected.matterId });
          return { imported: 1, inAppNotified: 1 };
        },
        async save(state) { stagedState = state; },
      });
      events.clear(); for (const entry of stagedEvents) events.set(...entry);
      notices.clear(); for (const entry of stagedNotices) notices.set(...entry);
      states.set(key, stagedState); return result;
    });
    queue = run.catch(() => {}); return run;
  } };
  return { store, states, events, notices,
    fail(value) { failNotification = value; }, eligible(value) { eligible = value; } };
}

test("redelivery and concurrent calls dedupe capture and internal notice", async () => {
  const f = fixture(), p = provider([event("one"), event("one")]);
  const results = await Promise.all([syncCourt(scope, p, f.store, time), syncCourt(scope, p, f.store, time)]);
  assert.equal(results.reduce((n, r) => n + r.imported, 0), 1);
  assert.equal(f.events.size, 1); assert.equal(f.notices.size, 1);
  assert.equal(results[0].deviceDelivery, "not-attempted");
});
test("same provider identity is isolated by workspace, matter and source", async () => {
  const f = fixture();
  for (const selected of [scope, { ...scope, workspaceId: "other" }, { ...scope, matterId: "other" }, { ...scope, source: "DJEN" }]) {
    await syncCourt(selected, { ...provider([event("same")]), source: selected.source }, f.store, time);
  }
  assert.equal(f.events.size, 4); assert.equal(f.states.size, 4);
});
test("notification failure rolls back events and cursor; re-delivery retries", async () => {
  const f = fixture(); f.fail(true);
  await assert.rejects(syncCourt(scope, provider([event("retry")]), f.store, time), /notification failure/);
  assert.equal(f.events.size, 0); assert.equal(f.states.size, 0);
  f.fail(false);
  assert.equal((await syncCourt(scope, provider([event("retry")]), f.store, time)).inAppNotified, 1);
});
test("partial response imports evidence without advancing cursor or last success", async () => {
  const f = fixture();
  await syncCourt(scope, provider([event("one")], "confirmed"), f.store, time);
  const r = await syncCourt(scope, provider([event("two")], "unsafe", false), f.store, time);
  assert.equal(r.state.cursor, "confirmed"); assert.equal(r.state.lastSuccess, time().toISOString());
  assert.equal(r.state.status, "partial"); assert.equal(r.imported, 1);
  const retry = await syncCourt(scope, provider([event("one"), event("two")], "finished"), f.store, time);
  assert.equal(retry.imported, 0); assert.equal(retry.state.cursor, "finished");
});
test("provider failures preserve cursor and success; private messages do not leak", async () => {
  const f = fixture();
  await syncCourt(scope, provider([]), f.store, time);
  const r = await syncCourt(scope, { source: "DATAJUD", async read(cursor) {
    assert.equal(cursor, "next"); throw new Error("private token secret");
  } }, f.store, time);
  assert.equal(r.state.reason, "PROVIDER_UNAVAILABLE"); assert.equal(r.state.cursor, "next");
  assert.equal(r.state.lastSuccess, time().toISOString()); assert.equal(r.imported, 0);
  assert.equal(JSON.stringify(r).includes("secret"), false);
});
test("missing credentials, rate limit and timeout are unavailable with no retry", async () => {
  for (const reason of ["MISSING_CREDENTIALS", "RATE_LIMIT", "TIMEOUT"]) {
    const f = fixture(); let calls = 0;
    const r = await syncCourt(scope, { source: "DATAJUD", async read() { calls++; throw new ProviderUnavailable(reason); } }, f.store, time);
    assert.equal(calls, 1); assert.equal(r.state.reason, reason);
    assert.equal(r.state.lastSuccess, null); assert.equal(r.state.cursor, null);
  }
});
test("default production provider performs zero network requests", async () => {
  const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("network forbidden in test"); };
  try {
    const r = await syncCourt(scope, unavailableProvider("DATAJUD"), fixture().store, time);
    assert.equal(r.state.reason, "DESKTOP_NETWORK_DISABLED"); assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});
test("ineligible scope never calls provider or records attempt", async () => {
  const f = fixture(); f.eligible(false);
  const r = await syncCourt(scope, { source: "DATAJUD", async read() { throw new Error("must not call"); } }, f.store, time);
  assert.equal(r.skipped, true); assert.equal(r.state.lastAttempt, null); assert.equal(f.events.size, 0);
});
test("source mismatch and malformed response cannot advance cursor", async () => {
  const f = fixture();
  await assert.rejects(syncCourt(scope, { ...provider([]), source: "DJEN" }, f.store), /mismatch/);
  const r = await syncCourt(scope, provider([{ ...event("x"), id: "" }]), f.store, time);
  assert.equal(r.state.reason, "INVALID_RESPONSE"); assert.equal(r.state.lastSuccess, null);
});
test("preserves source date, invalid raw dates and capture timestamp separately", async () => {
  const f = fixture(); await syncCourt(scope, provider([event("x", "invalid")]), f.store, time);
  const row = [...f.events.values()][0];
  assert.equal(row.selected.source, "DATAJUD"); assert.equal(row.item.occurredAt, "invalid");
  assert.equal(row.capturedAt, time().toISOString());
});
const number = "00000000020268260000"; // synthetic only
const movement = (codigo, dataHora) => ({ codigo, dataHora, nome: "Evento sintético" });
test("DataJud first snapshot is baseline evidence, identical second snapshot has zero new notices", async () => {
  const f = fixture();
  const process = { id: "synthetic-sequence", numeroProcesso: number, movimentos: [
    movement(1, "2026-10-01T10:00:00Z"), movement(2, "2026-10-02T10:00:00Z"),
  ] };
  const p = { source: "DATAJUD", async read(cursor) { return dataJudPage(number, process, cursor); } };
  const first = await syncCourt(scope, p, f.store, time);
  assert.equal(first.imported, 1); assert.equal(first.inAppNotified, 0);
  const second = await syncCourt(scope, p, f.store, time);
  assert.equal(second.imported, 0); assert.equal(second.inAppNotified, 0); assert.equal(f.notices.size, 0);
  process.movimentos.push(movement(3, "2026-10-03T10:00:00Z"));
  const third = await syncCourt(scope, p, f.store, time);
  assert.equal(third.imported, 1); assert.equal(third.inAppNotified, 1);
  assert.equal((await syncCourt(scope, p, f.store, time)).inAppNotified, 0);
});
test("DataJud more than 200 historical identities never become notices after bootstrap or reordering", () => {
  const process = { id: "synthetic-history", numeroProcesso: number,
    movimentos: Array.from({ length: 350 }, (_, i) => movement(i, "2026-10-01T10:00:00Z")) };
  const first = dataJudPage(number, process, null);
  assert.equal(first.events.length, 1); assert.equal(first.events[0].notify, false); assert.equal(first.complete, true);
  process.movimentos.reverse();
  const second = dataJudPage(number, process, first.cursor);
  assert.equal(second.events.length, 0); assert.equal(second.cursor, first.cursor);
});
test("DataJud bounded checkpoints drain new identities without advancing complete cursor early", async () => {
  const f = fixture(), process = { id: "synthetic-paging", numeroProcesso: number, movimentos: [movement(1, null)] };
  const p = { source: "DATAJUD", async read(cursor) { return dataJudPage(number, process, cursor); } };
  const baseline = await syncCourt(scope, p, f.store, time);
  process.movimentos.push(...Array.from({ length: 201 }, (_, i) => movement(i + 2, null)));
  const batch = await syncCourt(scope, p, f.store, time);
  assert.equal(batch.inAppNotified, 200); assert.equal(batch.state.status, "partial");
  assert.equal(batch.state.cursor, baseline.state.cursor); assert.ok(batch.state.resumeCursor);
  assert.equal(batch.state.lastSuccess, baseline.state.lastSuccess);
  process.movimentos.reverse();
  const end = await syncCourt(scope, p, f.store, time);
  assert.equal(end.inAppNotified, 1); assert.equal(end.state.resumeCursor, null);
  assert.equal(end.state.status, "success"); assert.equal(f.notices.size, 201);
  assert.equal((await syncCourt(scope, p, f.store, time)).inAppNotified, 0);
});
test("DataJud checkpoint rolls back on notice failure and resumes safely after provider failure", async () => {
  const f = fixture(), process = { id: "synthetic-retry", numeroProcesso: number, movimentos: [movement(1, null)] };
  const p = { source: "DATAJUD", async read(cursor) { return dataJudPage(number, process, cursor); } };
  const baseline = await syncCourt(scope, p, f.store, time);
  process.movimentos.push(...Array.from({ length: 201 }, (_, i) => movement(i + 2, null)));
  f.fail(true); await assert.rejects(syncCourt(scope, p, f.store, time));
  assert.equal(f.states.get(scopeKey(scope)).cursor, baseline.state.cursor);
  assert.equal(f.states.get(scopeKey(scope)).resumeCursor, null);
  f.fail(false); const partial = await syncCourt(scope, p, f.store, time);
  const failure = await syncCourt(scope, { source: "DATAJUD", async read() { throw new Error("fixture unavailable"); } }, f.store, time);
  assert.equal(failure.state.resumeCursor, partial.state.resumeCursor);
  assert.equal((await syncCourt(scope, p, f.store, time)).inAppNotified, 1);
});
test("DataJud refuses legacy, other-source or changed-process baselines rather than reannouncing history", () => {
  const process = { id: "synthetic-original", numeroProcesso: number, movimentos: [movement(1, null)] };
  const first = dataJudPage(number, process, null);
  assert.throws(() => dataJudPage(number, process, "snapshot-baseline-v1"), /INVALID_DATAJUD_BASELINE/);
  assert.throws(() => dataJudPage(number, process, "window:2026-10-07"), /INVALID_DATAJUD_BASELINE/);
  assert.throws(() => dataJudPage(number, { ...process, id: "changed" }, first.cursor), /SOURCE_ID_CHANGED/);
  const tooLarge = { ...JSON.parse(first.cursor), seen: Array(20_001).fill("a".repeat(64)) };
  assert.throws(() => dataJudPage(number, process, JSON.stringify(tooLarge)), /INVALID_DATAJUD_BASELINE/);
});
test("DataJud bootstrap avoids history flood; late/undated/same-time events remain candidates", () => {
  const process = { id: "synthetic", numeroProcesso: number, movimentos: [
    movement(1, "2026-10-01T10:00:00Z"), movement(2, "2026-10-02T10:00:00Z"),
  ] };
  const baseline = dataJudPage(number, process, null); assert.equal(baseline.events.length, 1);
  process.movimentos.push(movement(3, "2026-09-01T10:00:00Z"), movement(4, null), movement(5, "invalid"), movement(6, "2026-10-02T10:00:00Z"));
  const next = dataJudPage(number, process, baseline.cursor); assert.equal(next.events.length, 4);
  assert.equal(new Set(next.events.map(e => e.id)).size, 4);
  assert.ok(next.events.every(e => e.notify === true));
});
test("adapters reject a different process and expose truncation without false success", () => {
  assert.throws(() => dataJudPage(number, { id: "x", numeroProcesso: "99999999920268260000", movimentos: [] }, null), /PROCESS_MISMATCH/);
  assert.throws(() => djenPage(number, [{ numero_processo: "other" }], null, true, {}), /PROCESS_MISMATCH/);
  const baseline = dataJudPage(number, { id: "x", numeroProcesso: number, movimentos: [] }, null);
  const p = dataJudPage(number, { id: "x", numeroProcesso: number, movimentos: Array.from({ length: 201 }, (_, i) => movement(i, null)) }, baseline.cursor);
  assert.equal(p.complete, false); assert.equal(p.events.length, 200);
});
test("DJEN strips executable HTML and keeps provider source and query window", () => {
  const p = djenPage(number, [{ id: "synthetic", numero_processo: number, texto: "<script>secret()</script><b>Teste</b>", data_disponibilizacao: "2026-10-07" }], null, false,
    { startDate: "2026-10-06", endDate: "2026-10-07" });
  assert.equal(p.complete, false); assert.ok(p.events[0].body.includes("Teste"));
  assert.equal(p.events[0].body.includes("secret()"), false);
  assert.equal(p.events[0].occurredAt, "2026-10-07T03:00:00.000Z");
  assert.equal(p.events[0].evidence.provider, "CNJ_DJEN_PUBLIC");
});
test("DJEN bootstrap preserves evidence and requests only one initial internal notice", () => {
  const publications = ["2026-10-06", "2026-10-07"].map((date, i) => ({
    id: "synthetic-" + i, numero_processo: number, data_disponibilizacao: date, texto: "Teste",
  }));
  const window = { startDate: "2026-10-06", endDate: "2026-10-07" };
  const first = djenPage(number, publications, null, true, window);
  assert.equal(first.events.length, 2); assert.equal(first.events.filter(e => e.notify).length, 1);
  const next = djenPage(number, publications, first.cursor, true, window);
  assert.equal(next.events.filter(e => e.notify).length, 2);
});
