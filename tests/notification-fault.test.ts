import { describe, expect, it, vi } from "vitest";
import { notificationFault } from "./helpers/notification-fault";
import { guardedDatabaseLifecycle } from "./helpers/disposable-db";
function database(failAt = 0) {
  const sql: string[] = []; let committed: string[] = [];
  const tx = { $executeRawUnsafe: vi.fn(async (statement: string) => {
    sql.push(statement); if (sql.length === failAt) throw new Error("DDL failed");
  }) };
  const db = {
    $executeRawUnsafe: vi.fn(async (_sql: string) => {}),
    $disconnect: vi.fn(async () => {}),
    $transaction: vi.fn(async (action: (connection: typeof tx) => Promise<void>) => {
      const result = await action(tx); committed = [...sql]; return result;
    }),
  };
  return { db, tx, sql, committed: () => committed };
}
describe("fault fixture ownership without a database", () => {
  it("guard rejection makes zero queries, transactions, cleanup or disconnect calls", async () => {
    const { db } = database(); const fixture = notificationFault(db);
    const lifecycle = guardedDatabaseLifecycle(() => { throw new Error("guard rejected"); });
    await expect(lifecycle.setup(() => fixture.install(), db.$disconnect)).rejects.toThrow();
    await lifecycle.cleanup(async () => { await fixture.remove(); await db.$disconnect(); });
    expect(db.$transaction).not.toHaveBeenCalled(); expect(db.$executeRawUnsafe).not.toHaveBeenCalled(); expect(db.$disconnect).not.toHaveBeenCalled();
  });
  it.each([1, 2, 3])("partial setup failure at statement %i has no committed DDL or cleanup", async failAt => {
    const { db, committed } = database(failAt); const fixture = notificationFault(db);
    const lifecycle = guardedDatabaseLifecycle(() => {});
    await expect(lifecycle.setup(() => fixture.install(), db.$disconnect)).rejects.toThrow("DDL failed"); await fixture.remove();
    expect(db.$disconnect).toHaveBeenCalledTimes(1);
    expect(committed()).toEqual([]); expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });
  it("removes only its own unique objects, never replaces or drops existing names during setup", async () => {
    const a = database(), b = database(); const first = notificationFault(a.db), second = notificationFault(b.db);
    await first.install(); await second.install();
    const name = a.sql[0].match(/"(court_test_[a-f0-9]+)"/)![1];
    expect(b.sql[0]).not.toContain(name); expect(a.sql.join(" ")).not.toMatch(/REPLACE|DROP/);
    await first.enable(true); await first.enable(false); await first.remove(); await first.remove();
    expect(a.db.$transaction).toHaveBeenCalledTimes(2);
    expect(a.sql.slice(3)).toEqual([`DROP TRIGGER "${name}" ON "UserNotification"`, `DROP FUNCTION "${name}"()`]);
  });
});
