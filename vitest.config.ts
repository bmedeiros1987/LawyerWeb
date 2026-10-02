import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    globalSetup: ["./tests/helpers/validate-test-database.ts"],
    include: ["tests/**/*.test.ts"], fileParallelism: false,
    env: { DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/mblz_ci" },
  },
});
