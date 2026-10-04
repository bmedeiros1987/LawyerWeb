import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["tests/e2e/*.spec.ts"], fileParallelism: false, testTimeout: 360_000, hookTimeout: 90_000 },
});
