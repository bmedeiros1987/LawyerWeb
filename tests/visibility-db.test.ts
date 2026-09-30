import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
});
