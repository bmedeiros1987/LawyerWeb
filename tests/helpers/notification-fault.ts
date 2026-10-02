import { randomUUID } from "node:crypto";

type Sql = { $executeRawUnsafe(sql: string): Promise<unknown> };
type Database = Sql & { $transaction(action: (tx: Sql) => Promise<void>): Promise<void> };

// Unique, internally generated SQL identifiers; never interpolate user input.
// All setup DDL is transactional: a failed statement rolls the whole setup back.
export function notificationFault(db: Database) {
  const name = `court_test_${randomUUID().replaceAll("-", "")}`;
  let installed = false;
  return {
    async install() {
      if (installed) throw new Error("Fault fixture already installed");
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'simulated notification failure'; END; $$ LANGUAGE plpgsql`);
        await tx.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE INSERT ON "UserNotification" FOR EACH ROW EXECUTE FUNCTION "${name}"()`);
        await tx.$executeRawUnsafe(`ALTER TABLE "UserNotification" DISABLE TRIGGER "${name}"`);
      });
      installed = true;
    },
    async enable(enabled: boolean) {
      if (!installed) throw new Error("Fault fixture was not installed");
      await db.$executeRawUnsafe(`ALTER TABLE "UserNotification" ${enabled ? "ENABLE" : "DISABLE"} TRIGGER "${name}"`);
    },
    async remove() {
      if (!installed) return;
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`DROP TRIGGER "${name}" ON "UserNotification"`);
        await tx.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);
      });
      installed = false;
    },
  };
}
