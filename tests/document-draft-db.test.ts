import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
const session = vi.hoisted(() => ({ user: { id: "" } }));
vi.mock("@/auth", () => ({ auth: async () => session }));
import { prisma } from "@/lib/prisma";
import { createDraft, listTemplates, readDraft, saveRevision, saveTemplate } from "@/lib/documents/drafts";
import { type Viewer } from "@/lib/authz/visibility";
import { GET as readContent, POST as saveContent } from "@/app/api/documents/[id]/content/route";
import { POST as createFromTemplate } from "@/app/api/document-templates/[id]/drafts/route";
import { PATCH as setStatus } from "@/app/api/documents/[id]/route";

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("document drafts with isolated PostgreSQL", () => {
  const workspaces: string[] = [], users: string[] = [];
  let author: Viewer, colleague: Viewer, stranger: Viewer;
  let templateId: string, documentId: string;
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const ws = await prisma.workspace.create({ data: { name: "Synthetic drafts", slug: `draft-tests-${randomUUID()}` } });
      workspaces.push(ws.id);
      const role = await prisma.workspaceRole.create({ data: { workspaceId: ws.id, name: "Synthetic role", permissions: { allow: ["*"] } } });
      for (let j = 0; j < (i === 0 ? 2 : 1); j++) {
        const user = await prisma.user.create({ data: { name: "Synthetic draft author" } }); users.push(user.id);
        const member = await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: user.id, roleId: role.id }, include: { role: true } });
        if (i === 1) stranger = member; else if (j === 1) colleague = member; else author = member;
      }
    }
    session.user.id = author.userId;
  });
  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it("saves a model once across concurrent retries, fills a draft once and reopens exact content", async () => {
    const operation = randomUUID();
    const models = await Promise.all([saveTemplate(author, "Synthetic model", "Olá {{cliente}}.\nRevisão sintética.", operation), saveTemplate(author, "Synthetic model", "Olá {{cliente}}.\nRevisão sintética.", operation)]);
    expect(models[0].id).toBe(models[1].id); templateId = models[0].id;
    expect(await prisma.documentTemplate.count({ where: { id: templateId } })).toBe(1);
    expect(await prisma.activityLog.count({ where: { entityId: templateId, type: "DOCUMENT_TEMPLATE_CREATED" } })).toBe(1);
    const draftOperation = randomUUID();
    const drafts = await Promise.all([createDraft(author, templateId, "Minuta sintética", { cliente: "Pessoa fictícia" }, draftOperation), createDraft(author, templateId, "Minuta sintética", { cliente: "Pessoa fictícia" }, draftOperation)]);
    expect(drafts[0].id).toBe(drafts[1].id); documentId = drafts[0].id;
    expect(await prisma.documentVersion.count({ where: { documentId } })).toBe(1);
    expect(await readDraft(author, documentId)).toMatchObject({ version: 1, body: "Olá Pessoa fictícia.\nRevisão sintética." });
  });
  it("keeps the original, rejects lost-update races and makes save retries idempotent", async () => {
    const operations = [randomUUID(), randomUUID()];
    const results = await Promise.allSettled(operations.map((operation, i) => saveRevision(author, documentId, 1, `Revisão ${i}`, operation)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find(r => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason.status).toBe(409);
    const winner = results.findIndex(r => r.status === "fulfilled");
    const retried = await saveRevision(author, documentId, 1, `Revisão ${winner}`, operations[winner]);
    expect(retried.version).toBe(2);
    expect(await prisma.documentVersion.count({ where: { documentId } })).toBe(2);
    expect(await prisma.activityLog.count({ where: { entityId: documentId, type: "DOCUMENT_VERSION_CREATED" } })).toBe(1);
    expect((await readDraft(author, documentId, 1)).body).toBe("Olá Pessoa fictícia.\nRevisão sintética.");
    expect((await readDraft(author, documentId)).body).toBe(`Revisão ${winner}`);
    await expect(saveRevision(author, documentId, 1, "Changed retry", operations[winner])).rejects.toMatchObject({ status: 409 });
  });
  it("prevents foreign-account/workspace reads, writes and template reuse through actual routes", async () => {
    session.user.id = stranger.userId;
    const ctx = { params: Promise.resolve({ id: documentId }) };
    const readOwn = new NextRequest(`http://localhost/api/documents/${documentId}/content?workspaceId=${stranger.workspaceId}`);
    expect((await readContent(readOwn, ctx)).status).toBe(404);
    const forgedWorkspace = new NextRequest(`http://localhost/api/documents/${documentId}/content?workspaceId=${author.workspaceId}`);
    expect((await readContent(forgedWorkspace, ctx)).status).toBe(403);
    const post = (body: object) => new NextRequest("http://localhost/api/documents", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await saveContent(post({ operationId: randomUUID(), workspaceId: stranger.workspaceId, expectedVersion: 2, body: "Forbidden" }), ctx)).status).toBe(404);
    expect((await createFromTemplate(post({ operationId: randomUUID(), workspaceId: stranger.workspaceId, name: "Foreign draft", values: { cliente: "Other" } }), { params: Promise.resolve({ id: templateId }) })).status).toBe(404);
    expect(await listTemplates(stranger)).toEqual([]);
    session.user.id = author.userId;
  });
  it("keeps existing workspace collaboration while respecting matter and contract confidentiality", async () => {
    expect((await readDraft(colleague, documentId)).version).toBe(2);
    const matter = await prisma.matter.create({ data: { workspaceId: author.workspaceId, title: "Synthetic confidential matter", secrecy: true, access: { create: { memberId: author.id } } } });
    await prisma.contract.create({ data: { workspaceId: author.workspaceId, documentId, matterId: matter.id, title: "Synthetic confidential contract", contractType: "TEST" } });
    await expect(readDraft(colleague, documentId)).rejects.toMatchObject({ status: 404 });
    await expect(saveRevision(colleague, documentId, 2, "Forbidden", randomUUID())).rejects.toMatchObject({ status: 404 });
    expect((await readDraft(author, documentId)).version).toBe(2);
  });
  it("does not reuse an operation for different template content", async () => {
    const operation = randomUUID();
    await saveTemplate(author, "Immutable model", "First", operation);
    await expect(saveTemplate(author, "Immutable model", "Changed", operation)).rejects.toMatchObject({ status: 409 });
  });
  it("cannot approve stale content after a newer revision is committed", async () => {
    session.user.id = author.userId;
    const request = new NextRequest("http://localhost/api/documents", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: author.workspaceId, expectedVersion: 1, status: "APPROVED" }) });
    expect((await setStatus(request, { params: Promise.resolve({ id: documentId }) })).status).toBe(409);
    expect((await prisma.legalDocument.findUniqueOrThrow({ where: { id: documentId } })).status).toBe("DRAFT");
  });
});
