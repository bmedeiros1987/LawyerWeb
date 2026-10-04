import { expect, it } from "vitest";
import { requireDisposablePilotDatabase } from "./e2e/database-guard";
it("accepts only explicit disposable loopback database configuration", () => {
  const base = { RUN_PILOT_E2E: "1", DATABASE_URL: "postgresql://postgres:synthetic@127.0.0.1:5432/mblz_ci" };
  expect(requireDisposablePilotDatabase(base).hostname).toBe("127.0.0.1");
  for (const DATABASE_URL of [
    base.DATABASE_URL + "?host=remote.example.invalid", base.DATABASE_URL + "?hostaddr=192.0.2.1",
    base.DATABASE_URL + "?port=6432", base.DATABASE_URL + "?database=real", base.DATABASE_URL + "#fragment",
    "https://postgres@localhost:5432/mblz_ci", "postgresql://postgres@localhost/mblz_ci",
    "postgresql://postgres@localhost:6432/mblz_ci", "postgresql://postgres@remote.example.invalid:5432/mblz_ci",
    "postgresql://postgres@localhost:5432/other", "postgresql://other@localhost:5432/mblz_ci",
  ]) expect(() => requireDisposablePilotDatabase({ ...base, DATABASE_URL })).toThrow();
  expect(() => requireDisposablePilotDatabase({ ...base, RUN_PILOT_E2E: "0" })).toThrow();
});
