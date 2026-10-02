import { readFileSync } from "node:fs";

// Written by the isolated database provisioner, never inferred from DATABASE_URL.
// This is an explicit ownership attestation, not discovery of a safe database.
export function assertDisposableDatabase(env: Record<string, string | undefined> = process.env) {
  const fail = () => { throw new Error("DB tests require an exclusive disposable database manifest matching this run."); };
  if (env.RUN_DB_TESTS !== "1" || !env.DB_TEST_MANIFEST || !env.DB_TEST_RUN_ID) return fail();
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    const m = JSON.parse(readFileSync(env.DB_TEST_MANIFEST, "utf8"));
    const id = env.DB_TEST_RUN_ID;
    if (env.GITHUB_ACTIONS === "true" && (env.RUNNER_ENVIRONMENT !== "github-hosted"
      || m.provisionedBy !== "github-service-create-database"
      || !/^[a-f0-9]{64}$/.test(m.containerId ?? "")
      || m.workflowRunId !== env.GITHUB_RUN_ID || m.workflowRunAttempt !== env.GITHUB_RUN_ATTEMPT)) return fail();
    if (!/^[a-f0-9]{32}$/.test(id) || !["postgresql:", "postgres:"].includes(url.protocol)
      || !["localhost", "127.0.0.1"].includes(url.hostname) || url.search || url.hash
      || url.pathname !== `/mblz_test_${id}` || !url.port
      || m.runId !== id || m.database !== url.pathname.slice(1) || m.host !== url.hostname
      || String(m.port) !== url.port || m.disposable !== true || m.exclusive !== true
      || !Number.isFinite(m.expiresAt) || m.expiresAt <= Date.now()) return fail();
  } catch { return fail(); }
}

export function guardedDatabaseLifecycle(check = assertDisposableDatabase) {
  let ready = false;
  return {
    async setup(action: () => Promise<void>, releaseAfterFailure?: () => Promise<void>) {
      ready = false;
      check();
      try {
        await action();
        ready = true;
      } catch (error) {
        // The guard already passed. Release any pool opened by a failed setup,
        // but never run destructive cleanup for an uncommitted setup.
        await releaseAfterFailure?.();
        throw error;
      }
    },
    async cleanup(action: () => Promise<void>) {
      if (!ready) return;
      check();
      ready = false;
      await action();
    },
  };
}
