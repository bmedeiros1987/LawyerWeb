import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { requireDisposablePilotDatabase } from "./tests/e2e/database-guard";
// Runs before Vitest imports any test module or Prisma client.
requireDisposablePilotDatabase(process.env);
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["tests/e2e/*.spec.ts"], fileParallelism: false, testTimeout: 360_000, hookTimeout: 90_000 },
});
