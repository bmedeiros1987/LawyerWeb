import { afterEach, beforeEach, expect, it } from "vitest";
import { createMblzAgentToken, verifyMblzAgentToken } from "@/lib/agent/token";

const oldSecret = process.env.MBLZ_AGENT_SIGNING_SECRET;

beforeEach(() => {
  process.env.MBLZ_AGENT_SIGNING_SECRET = "ci-agent-signing-secret-0123456789abcdef";
});

afterEach(() => {
  if (oldSecret === undefined) delete process.env.MBLZ_AGENT_SIGNING_SECRET;
  else process.env.MBLZ_AGENT_SIGNING_SECRET = oldSecret;
});

it("binds token to user, workspace and explicit read scopes", () => {
  const now = Date.UTC(2026, 8, 30, 12, 0, 0);
  const { token } = createMblzAgentToken({
    userId: "user-a",
    workspaceId: "workspace-a",
    scopes: ["workspace:summary:read"],
    ttlSeconds: 3600,
  }, now);

  expect(verifyMblzAgentToken(token, "workspace:summary:read", now + 1_000)).toMatchObject({
    userId: "user-a",
    workspaceId: "workspace-a",
    scopes: ["workspace:summary:read"],
  });
  expect(() => verifyMblzAgentToken(token, "deadlines:read", now + 1_000)).toThrow("Agent scope denied");
});

it("rejects signature tampering and expiration", () => {
  const now = Date.UTC(2026, 8, 30, 12, 0, 0);
  const { token } = createMblzAgentToken({
    userId: "user-a",
    workspaceId: "workspace-a",
    scopes: ["deadlines:read"],
    ttlSeconds: 120,
  }, now);

  const last = token.at(-1) || "A";
  const tampered = token.slice(0, -1) + (last === "A" ? "B" : "A");
  expect(tampered).not.toBe(token);
  expect(() => verifyMblzAgentToken(tampered, "deadlines:read", now + 1_000)).toThrow("Invalid agent token");
  expect(() => verifyMblzAgentToken(token, "deadlines:read", now + 121_000)).toThrow("Expired agent token");
});

it("caps excessive token lifetime and fails without a configured signing key", () => {
  const now = Date.UTC(2026, 8, 30, 12, 0, 0);
  const { claims } = createMblzAgentToken({
    userId: "user-a",
    workspaceId: "workspace-a",
    scopes: ["deadlines:read"],
    ttlSeconds: 365 * 24 * 60 * 60,
  }, now);
  expect(claims.exp - claims.iat).toBe(7 * 24 * 60 * 60);

  delete process.env.MBLZ_AGENT_SIGNING_SECRET;
  expect(() => createMblzAgentToken({
    userId: "user-a",
    workspaceId: "workspace-a",
    scopes: ["deadlines:read"],
  }, now)).toThrow("MBLZ_AGENT_SIGNING_SECRET");
});
