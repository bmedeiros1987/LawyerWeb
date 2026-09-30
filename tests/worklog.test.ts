import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => Object.fromEntries(
  ["matter", "legalTask", "deadline", "contract", "legalDocument", "courtCommunication", "intakeDemand", "client"]
    .map(name => [name, { findMany: vi.fn() }]),
));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { visibleActivities } from "@/lib/reports/worklog";
import { allows, contractScope, documentScope, taskScope, type Viewer } from "@/lib/authz/visibility";
const viewer: Viewer = { id: "member", userId: "user", workspaceId: "workspace", status: "ACTIVE", role: { permissions: { allow: ["*"] } } };
beforeEach(() => { for (const model of Object.values(db)) model.findMany.mockReset().mockResolvedValue([]); });

it("removes the author's own summaries after entity access is revoked or the entity is deleted", async () => {
  const entries = [{ entityType: "Matter", entityId: "revoked", metadata: null }, { entityType: "LegalTask", entityId: "deleted", metadata: null }];
  expect(await visibleActivities(viewer, entries)).toEqual([]);
  expect(db.matter.findMany.mock.calls[0][0].where.AND[0]).toMatchObject({ workspaceId: "workspace", OR: [{ secrecy: false }, { access: { some: { memberId: "member" } } }] });
});

it("keeps an accessible event but rejects an unknown entity type", async () => {
  db.legalTask.findMany.mockResolvedValue([{ id: "task" }]);
  const entry = { entityType: "LegalTask", entityId: "task", metadata: null };
  expect(await visibleActivities(viewer, [entry, { ...entry, entityType: "Unknown" }])).toEqual([entry]);
});

it("checks the old matter reference even when the live entity is now visible", async () => {
  db.contract.findMany.mockResolvedValue([{ id: "contract" }]);
  expect(await visibleActivities(viewer, [{ entityType: "Contract", entityId: "contract", metadata: { matterId: "old-secret" } }])).toEqual([]);
});

it("does not grant operational modules to the finance report role", () => {
  const finance = { ...viewer, role: { permissions: { allow: ["reports.view", "finance.view"] } } };
  expect(contractScope(finance)).toEqual({ id: { in: [] } });
  expect(documentScope(finance)).toEqual({ id: { in: [] } });
  expect(taskScope(finance)).toEqual({ id: { in: [] } });
  expect(allows({ ...viewer, status: "SUSPENDED" }, "reports.view")).toBe(false);
});

it("applies private-task ACL in addition to matter ACL", () => {
  expect(taskScope(viewer)).toMatchObject({ AND: [expect.anything(), { OR: [
    { private: false }, { requesterUserId: "user" }, { assigneeUserId: "user" }, { reviewerUserId: "user" },
  ] }] });
});

it("includes both directions of contract/document confidentiality without recursive queries", () => {
  const contract = JSON.stringify(contractScope(viewer));
  const document = JSON.stringify(documentScope(viewer));
  expect(contract).toContain('"document"');
  expect(document).toContain('"contracts":{"every"');
  expect(contract).toContain('"memberId":"member"');
});
