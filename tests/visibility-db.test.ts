import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const session = vi.hoisted(() => ({ user: { id: "" } }));
vi.mock("@/auth", () => ({ auth: async () => session }));
import { POST as triage } from "@/app/api/inbox/triage/route";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { contractScope, documentScope, taskScope, type Viewer } from "@/lib/authz/visibility";
import { visibleActivities } from "@/lib/reports/worklog";

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("PostgreSQL confidentiality", () => {
  const suffix = randomUUID();
  let viewer: Viewer;
  let matterId: string;
  let contractId: string;
  let documentId: string;
  let otherWorkspaceId: string;
  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Security test", email: `acl-${suffix}@example.invalid` } });
    const workspace = await prisma.workspace.create({ data: { name: "Isolated test", slug: `acl-${suffix}` } });
    viewer = { id: "", userId: user.id, workspaceId: workspace.id, status: "ACTIVE", role: { permissions: { allow: ["*"] } } };
    session.user.id = user.id;
    const role = await prisma.workspaceRole.create({ data: { workspaceId: workspace.id, name: "Test", permissions: { allow: ["*"] } } });
    const member = await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, roleId: role.id } });
    viewer.id = member.id;
    const other = await prisma.workspace.create({ data: { name: "Other tenant", slug: `other-${suffix}` } });
    otherWorkspaceId = other.id;
    const matter = await prisma.matter.create({ data: { workspaceId: workspace.id, title: "Secret matter", secrecy: true } });
    matterId = matter.id;
    const document = await prisma.legalDocument.create({ data: { workspaceId: workspace.id, name: "Linked secret" } });
    documentId = document.id;
    const contract = await prisma.contract.create({ data: { workspaceId: workspace.id, title: "Secret contract", contractType: "TEST", matterId, documentId } });
    contractId = contract.id;
    await prisma.legalTask.createMany({ data: [
      { workspaceId: workspace.id, title: "Private task", private: true, requesterUserId: "someone-else" },
      { workspaceId: other.id, title: "Other tenant task" },
    ] });
  });
  afterAll(async () => {
    if (viewer) {
      await prisma.workspace.delete({ where: { id: viewer.workspaceId } });
      await prisma.user.delete({ where: { id: viewer.userId } });
    }
    if (otherWorkspaceId) await prisma.workspace.delete({ where: { id: otherWorkspaceId } });
    await prisma.$disconnect();
  });
  it("blocks secret contracts, their documents, private tasks and other workspaces", async () => {
    expect(await prisma.contract.findMany({ where: contractScope(viewer) })).toEqual([]);
    expect(await prisma.legalDocument.findMany({ where: documentScope(viewer) })).toEqual([]);
    expect(await prisma.legalTask.findMany({ where: taskScope(viewer) })).toEqual([]);
  });
  it("rechecks revoked ACLs in the author's historical worklog", async () => {
    const entry = { entityType: "Contract", entityId: contractId, metadata: { matterId } };
    await prisma.matterAccess.create({ data: { matterId, memberId: viewer.id } });
    expect(await visibleActivities(viewer, [entry])).toEqual([entry]);
    expect(await prisma.legalDocument.findMany({ where: documentScope(viewer), select: { id: true } })).toEqual([{ id: documentId }]);
    await prisma.matterAccess.deleteMany({ where: { matterId, memberId: viewer.id } });
    expect(await visibleActivities(viewer, [entry])).toEqual([]);
  });
  const request = (sourceId: string, action: string, extra = {}) => triage(new NextRequest("http://localhost/api/inbox/triage", {
    method: "POST", body: JSON.stringify({ workspaceId: viewer.workspaceId, sourceType: "DEMAND", sourceId, action, ...extra }),
  }));
  it("rejects inaccessible sources and prevents detaching their confidentiality", async () => {
    const source = await prisma.intakeDemand.create({ data: { workspaceId: viewer.workspaceId, matterId, source: "TEST", externalId: randomUUID(), title: "Secret source" } });
    expect((await request(source.id, "CREATE_TASK")).status).toBe(400);
    await prisma.matterAccess.create({ data: { matterId, memberId: viewer.id } });
    expect((await request(source.id, "CREATE_TASK", { matterId: null })).status).toBe(409);
    expect(await prisma.legalTask.count({ where: { workspaceId: viewer.workspaceId, title: "Secret source" } })).toBe(0);
  });
  it("serializes simultaneous conversions into one task and one audit event", async () => {
    const source = await prisma.intakeDemand.create({ data: { workspaceId: viewer.workspaceId, matterId, source: "TEST", externalId: randomUUID(), title: "Concurrent source" } });
    const results = await Promise.all([request(source.id, "CREATE_TASK"), request(source.id, "CREATE_TASK")]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.legalTask.count({ where: { workspaceId: viewer.workspaceId, title: source.title } })).toBe(1);
    expect(await prisma.activityLog.count({ where: { workspaceId: viewer.workspaceId, entityId: source.id, type: "INBOX_TASK_CREATED" } })).toBe(1);
    expect((await request(source.id, "MARK_READ")).status).toBe(409);
  });
  it("preserves source evidence and date as a candidate, without legal start or reminders", async () => {
    const due = new Date("2030-10-01T18:00:00.000Z");
    const source = await prisma.intakeDemand.create({ data: { workspaceId: viewer.workspaceId, source: "TEST", externalId: randomUUID(), title: "Candidate source", dueCandidate: due, evidence: { messageId: "test-message" } } });
    const response = await request(source.id, "CREATE_DEADLINE");
    expect(response.status).toBe(201);
    const { deadline } = await response.json();
    expect(deadline).toMatchObject({ status: "CANDIDATE", confirmedAt: null, legalStartAt: null, dueAt: due.toISOString(), computationTrace: { sourceId: source.id, evidence: { messageId: "test-message" } } });
    expect(await prisma.deadlineReminder.count({ where: { deadlineId: deadline.id } })).toBe(0);
  });
  it("audits dismissal and refuses subsequent conversion", async () => {
    const source = await prisma.intakeDemand.create({ data: { workspaceId: viewer.workspaceId, source: "TEST", externalId: randomUUID(), title: "Dismissed source" } });
    expect((await request(source.id, "DISMISS")).status).toBe(200);
    expect((await prisma.intakeDemand.findUniqueOrThrow({ where: { id: source.id } })).status).toBe("DISMISSED");
    expect((await request(source.id, "CREATE_TASK")).status).toBe(409);
    expect(await prisma.activityLog.count({ where: { entityId: source.id, type: "INBOX_DISMISSED" } })).toBe(1);
  });
});
