// Synthetic. The policy is pure: no transport, token or account exists to test against, by design.
import { describe, expect, it } from "vitest";
import { READ_ONLY_PHASE, READ_ONLY_TOOLS, auditRecord, confirmationDigest, decide, stableJson, type Call, type Grant, type McpTool } from "@/lib/mcp/policy";

const read = READ_ONLY_TOOLS[1];
const write: McpTool = { name: "documents.apply_suggestion", mutates: true, scope: "documents:write", permission: "documents.edit" };
const now = 1_000_000;
const grant: Grant = { id: "g1", userId: "u1", workspaceId: "w1", scopes: ["documents:read", "documents:write"], documentIds: ["d1"], expiresAt: now + 60_000 };
const call: Call = { userId: "u1", workspaceId: "w1", documentId: "d1", params: { start: 0, end: 10 } };
const run = (over: Partial<Parameters<typeof decide>[0]> = {}) => decide({ grant, tool: read, call, now, holdsPermission: true, ...over });

describe("MCP policy", () => {
  it("starts read-only and minimal", () => {
    expect(READ_ONLY_PHASE).toBe(true);
    expect(READ_ONLY_TOOLS.every(t => !t.mutates)).toBe(true);
    expect(run()).toEqual({ allow: true });
  });
  it.each([
    ["another user", { call: { ...call, userId: "u2" } }, "wrong-user"],
    ["another workspace", { call: { ...call, workspaceId: "w2" } }, "wrong-workspace"],
    ["revoked grant", { grant: { ...grant, revokedAt: now - 1 } }, "revoked"],
    ["expired grant", { grant: { ...grant, expiresAt: now } }, "expired"],
    ["missing scope", { grant: { ...grant, scopes: [] } }, "scope"],
    ["document outside the grant", { call: { ...call, documentId: "d2" } }, "document-not-granted"],
    ["no document named when the grant is document-scoped", { call: { ...call, documentId: undefined } }, "document-not-granted"],
    ["role lost the permission since the grant", { holdsPermission: false }, "permission"],
  ])("denies: %s", (_n, over, reason) => expect(run(over as never)).toEqual({ allow: false, reason }));
  it("revocation applies from the moment it is recorded, not retroactively", () => {
    expect(run({ grant: { ...grant, revokedAt: now + 1 } })).toEqual({ allow: true });
  });
  it("refuses every mutation in the read-only phase, even with a perfect confirmation", () => {
    const confirmation = { digest: confirmationDigest(write, call), expiresAt: now + 1000 };
    expect(decide({ grant, tool: write, call, now, holdsPermission: true, confirmation })).toEqual({ allow: false, reason: "read-only-phase" });
  });
  it("a confirmation digest binds tool, user, workspace, document and exact parameters", () => {
    const base = confirmationDigest(write, call);
    expect(confirmationDigest(write, { ...call, params: { end: 10, start: 0 } })).toBe(base); // key order is irrelevant
    for (const other of [{ ...call, params: { start: 0, end: 11 } }, { ...call, documentId: "d2" }, { ...call, userId: "u2" }, { ...call, workspaceId: "w2" }]) expect(confirmationDigest(write, other)).not.toBe(base);
    expect(confirmationDigest({ ...write, name: "documents.delete" }, call)).not.toBe(base);
    expect(stableJson({ b: [1, { d: 1, c: 2 }], a: null })).toBe('{"a":null,"b":[1,{"c":2,"d":1}]}');
  });
  it("audit records identify the actor and outcome but never parameters", () => {
    const rec = auditRecord(grant, read, { ...call, params: { secret: "conteúdo confidencial" } }, run({ holdsPermission: false }), now);
    expect(rec).toMatchObject({ grantId: "g1", userId: "u1", tool: "documents.read_excerpt", allowed: false, reason: "permission" });
    expect(JSON.stringify(rec)).not.toContain("confidencial");
  });
});
