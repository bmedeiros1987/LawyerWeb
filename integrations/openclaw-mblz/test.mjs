import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "index.ts"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(here, "openclaw.plugin.json"), "utf8"));

assert.deepEqual(manifest.contracts.tools.sort(), ["mblz_upcoming_deadlines", "mblz_workspace_summary"]);
assert.match(source, /toolContext\.requesterSenderId/g, "identity must be injected by trusted OpenClaw runtime context");
assert.match(source, /MBLZ_OPENCLAW_BINDINGS_JSON/, "credentials must remain server-side");
assert.match(source, /authorization: `Bearer/, "agent credential must be sent as bearer auth");
assert.match(source, /\/api\/agent\/summary/, "summary tool must use dedicated read-only endpoint");
assert.match(source, /\/api\/agent\/deadlines/, "deadline tool must use dedicated read-only endpoint");
assert.doesNotMatch(source, /parameters:[\s\S]{0,400}(userId|workspaceId|email|token)\s*:/, "model must not choose tenant identity");
assert.doesNotMatch(source, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/, "OpenClaw MBLZ adapter must remain read-only");

console.log("[openclaw-mblz] PASS — sender-bound tools cannot select tenant identity or mutate MBLZ.");
