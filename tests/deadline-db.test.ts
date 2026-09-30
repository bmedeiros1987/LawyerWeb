import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
const session = vi.hoisted(() => ({ user: { id: "" } }));
vi.mock("@/auth", () => ({ auth: async () => session }));
import { prisma } from "@/lib/prisma";
import { confirmDeadline, completeDeadline, canReceiveDeadline } from "@/lib/deadlines/service";
import { POST as createContract } from "@/app/api/contracts/route";
import { PATCH as updateDocument } from "@/app/api/documents/[id]/route";
import { GET as getMatter } from "@/app/api/matters/[id]/route";

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("Deadline Safety and indirect access", () => {
  let workspaceId: string, roleId: string, matterId: string;
  const users: string[] = [], members: string[] = [];
  beforeAll(async () => {
    const ws = await prisma.workspace.create({ data: { name: "Deadline test", slug: `deadline-${randomUUID()}` } });
    workspaceId = ws.id;
    roleId = (await prisma.workspaceRole.create({ data: { workspaceId, name: "Test owner", permissions: { allow: ["*"] } } })).id;
    for (let i = 0; i < 3; i++) {
      const user = await prisma.user.create({ data: { name: `Test ${i}` } });
      users.push(user.id);
      const member = await prisma.workspaceMember.create({ data: { workspaceId, userId: user.id, roleId } });
      members.push(member.id);
    }
    session.user.id = users[0];
    matterId = (await prisma.matter.create({ data: { workspaceId, title: "Secret", secrecy: true } })).id;
    await prisma.matterAccess.createMany({ data: members.slice(0, 2).map(memberId => ({ matterId, memberId })) });
  });
  afterAll(async () => {
    if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });
  const candidate = () => prisma.deadline.create({ data: { workspaceId, matterId, title: "Candidate" } });
  const confirmation = (deadlineId: string) => ({
    workspaceId, deadlineId, confirmedByUserId: users[0], primaryResponsibleUserId: users[0], reviewerUserId: users[1],
    dueAt: new Date(Date.now() + 10 * 86400000), internalDueAt: new Date(Date.now() + 8 * 86400000), ruleSummary: "Fonte e cálculo conferidos pelo responsável.",
  });
  it("requires independent reviewer, internal deadline and human calculation before scheduling reminders", async () => {
    const d = await candidate(), input = confirmation(d.id);
    await expect(confirmDeadline({ ...input, internalDueAt: null })).rejects.toThrow("prazo interno");
    await expect(confirmDeadline({ ...input, reviewerUserId: users[0] })).rejects.toThrow("diferente");
    await expect(confirmDeadline({ ...input, ruleSummary: " " })).rejects.toThrow("fundamento");
    await expect(completeDeadline({ deadlineId: d.id, workspaceId, userId: users[0] })).rejects.toThrow("Confirme");
    expect(await prisma.deadlineReminder.count({ where: { deadlineId: d.id } })).toBe(0);
    const confirmed = await confirmDeadline(input);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedByUserId).toBe(users[0]);
    expect(await prisma.deadlineReminder.count({ where: { deadlineId: d.id } })).toBeGreaterThan(0);
    await completeDeadline({ deadlineId: d.id, workspaceId, userId: users[0] });
    await expect(confirmDeadline(input)).rejects.toThrow("candidato");
    expect(await prisma.deadlineReminder.count({ where: { deadlineId: d.id, status: "PENDING" } })).toBe(0);
  });
  it("rejects an unauthorized confirmer, reviewer, recipient and completer even with wildcard role", async () => {
    const d = await candidate(), input = confirmation(d.id);
    await expect(confirmDeadline({ ...input, confirmedByUserId: users[2] })).rejects.toThrow("sem acesso");
    await expect(confirmDeadline({ ...input, reviewerUserId: users[2] })).rejects.toThrow("acesso ativo");
    expect(await canReceiveDeadline(users[2], workspaceId, d.id)).toBe(false);
    await confirmDeadline(input);
    await prisma.matterAccess.deleteMany({ where: { matterId, memberId: members[1] } });
    expect(await canReceiveDeadline(users[1], workspaceId, d.id)).toBe(false);
    await expect(completeDeadline({ deadlineId: d.id, workspaceId, userId: users[2] })).rejects.toThrow("sem acesso");
  });
  it("does not attach an inaccessible document to a public contract", async () => {
    const hiddenMatter = await prisma.matter.create({ data: { workspaceId, title: "Other secret", secrecy: true } });
    const doc = await prisma.legalDocument.create({ data: { workspaceId, matterId: hiddenMatter.id, name: "Hidden document" } });
    const response = await createContract(new NextRequest("http://localhost/api/contracts", { method: "POST", body: JSON.stringify({ workspaceId, title: "Public contract", contractType: "TEST", documentId: doc.id }) }));
    expect(response.status).toBe(400);
    expect(await prisma.contract.count({ where: { workspaceId, documentId: doc.id } })).toBe(0);
  });
  it("rejects manually signed status without a signed current version and prevents removing secrecy", async () => {
    const doc = await prisma.legalDocument.create({ data: { workspaceId, matterId, name: "Draft" } });
    const patch = (data: object) => updateDocument(new NextRequest("http://localhost/api/documents/" + doc.id, { method: "PATCH", body: JSON.stringify({ workspaceId, ...data }) }), { params: Promise.resolve({ id: doc.id }) });
    expect((await patch({ status: "SIGNED" })).status).toBe(409);
    expect((await patch({ matterId: null })).status).toBe(409);
    expect((await prisma.legalDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe("DRAFT");
  });
  it("does not reveal private tasks through the process detail endpoint", async () => {
    await prisma.legalTask.create({ data: { workspaceId, matterId, title: "Private work", private: true, assigneeUserId: users[1] } });
    const response = await getMatter(new Request("http://localhost/api/matters/" + matterId), { params: Promise.resolve({ id: matterId }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matter.tasks).toEqual([]);
    expect(data.timeline.some((entry: { title: string }) => entry.title === "Private work")).toBe(false);
  });
});
