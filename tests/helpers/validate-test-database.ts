import { assertDisposableDatabase } from "./disposable-db";

export function validateTestDatabase(env: Record<string, string | undefined> = process.env) {
  if (env.RUN_DB_TESTS === "1") assertDisposableDatabase(env);
}

// Runs before test modules load: older DB suites cannot bypass the shared guard.
export default function setup() { validateTestDatabase(); }
