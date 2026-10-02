import { describe, it, expect, vi } from "vitest";
vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));
import { readFileSync } from "node:fs";
import { validateTestDatabase } from "./helpers/validate-test-database";
import { assertDisposableDatabase, guardedDatabaseLifecycle } from "./helpers/disposable-db";
const id = "a".repeat(32);
const env = () => ({ RUN_DB_TESTS: "1", DB_TEST_RUN_ID: id, DB_TEST_MANIFEST: "/fixture/manifest.json", DATABASE_URL: `postgresql://fake:fake@127.0.0.1:5544/mblz_test_${id}` });
const manifest = () => ({ runId: id, host: "127.0.0.1", port: 5544, database: `mblz_test_${id}`, disposable: true, exclusive: true, expiresAt: Date.now() + 60000 });
describe("disposable database gate (no database)", () => {
  it.each([{}, { RUN_DB_TESTS: "1" }, { ...env(), DATABASE_URL: "postgresql://localhost:5432/mblz_ci" }, { ...env(), DATABASE_URL: `postgresql://remote:5544/mblz_test_${id}` }, { ...env(), DATABASE_URL: env().DATABASE_URL + "?host=remote" }])("rejects unproven destinations with zero DB operations", async (e) => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(manifest()));
    const db = vi.fn(); const lifecycle = guardedDatabaseLifecycle(() => assertDisposableDatabase(e));
    await expect(lifecycle.setup(db)).rejects.toThrow(); await lifecycle.cleanup(db);
    expect(db).not.toHaveBeenCalled();
  });
  it.each([{ exclusive: false }, { disposable: false }, { expiresAt: 0 }, { runId: "other" }, { port: 5432 }, { database: "production" }])("rejects invalid attestation", (change) => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ ...manifest(), ...change }));
    expect(() => assertDisposableDatabase(env())).toThrow();
  });
  it("accepts exact matching attestation", () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(manifest()));
    expect(() => assertDisposableDatabase(env())).not.toThrow();
  });
  it("does not clean up an incomplete setup", async () => {
    const cleanup = vi.fn(); const lifecycle = guardedDatabaseLifecycle(() => {});
    await expect(lifecycle.setup(async () => { throw new Error("setup failed"); })).rejects.toThrow();
    await lifecycle.cleanup(cleanup); expect(cleanup).not.toHaveBeenCalled();
  });
  it("rechecks approval before cleanup and performs zero cleanup operations on rejection", async () => {
    const check = vi.fn(); const cleanup = vi.fn(); const lifecycle = guardedDatabaseLifecycle(check);
    await lifecycle.setup(async () => {}); check.mockImplementation(() => { throw new Error("expired"); });
    await expect(lifecycle.cleanup(cleanup)).rejects.toThrow(); expect(cleanup).not.toHaveBeenCalled();
  });
  it("cleans up a completed approved setup once", async () => {
    const cleanup = vi.fn(); const lifecycle = guardedDatabaseLifecycle(() => {});
    await lifecycle.setup(async () => {}); await lifecycle.cleanup(cleanup); await lifecycle.cleanup(cleanup);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

it("global gate refuses DB mode before loading suites, but allows mock-only runs", () => {
  expect(() => validateTestDatabase({ RUN_DB_TESTS: "0" })).not.toThrow();
  expect(() => validateTestDatabase({ RUN_DB_TESTS: "1" })).toThrow();
});
it("CI gate requires provisioning provenance from the current workflow run", () => {
  const ci = { ...env(), GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" };
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify(manifest()));
  expect(() => assertDisposableDatabase(ci)).toThrow();
  const proof = { ...manifest(), provisionedBy: "github-service-create-database", containerId: "b".repeat(64), workflowRunId: "123", workflowRunAttempt: "1" };
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify(proof));
  expect(() => assertDisposableDatabase(ci)).not.toThrow();
  expect(() => assertDisposableDatabase({ ...ci, GITHUB_RUN_ATTEMPT: "2" })).toThrow();
});
