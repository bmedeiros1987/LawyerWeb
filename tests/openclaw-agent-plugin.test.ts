import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

it("keeps OpenClaw tenant identity outside model-controlled parameters", () => {
  const source = readFileSync(resolve("integrations/openclaw-mblz/index.mjs"), "utf8");
  const manifest = JSON.parse(readFileSync(resolve("integrations/openclaw-mblz/openclaw.plugin.json"), "utf8"));

  expect([...manifest.contracts.tools].sort()).toEqual(["mblz_upcoming_deadlines", "mblz_workspace_summary"]);
  expect(source).toMatch(/toolContext\.requesterSenderId/g);
  expect(source).toContain("MBLZ_OPENCLAW_BINDINGS_JSON");
  expect(source).toMatch(/authorization: `Bearer/);
  expect(source).toContain("/api/agent/summary");
  expect(source).toContain("/api/agent/deadlines");
  expect(source).not.toMatch(/parameters:[\s\S]{0,400}(userId|workspaceId|email|token)\s*:/);
  expect(source).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
});
