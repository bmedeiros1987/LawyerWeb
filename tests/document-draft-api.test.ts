import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  session: { user: { id: "author-a" } } as { user: { id: string } } | null,
  member: { id: "member-a", userId: "author-a", workspaceId: "workspace-a", status: "ACTIVE", role: { permissions: { allow: ["documents.view", "documents.edit"] } } },
  db: {
    workspaceMember: { findUnique: vi.fn() },
    documentTemplate: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    legalDocument: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    documentVersion: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
    activityLog: { create: vi.fn() },
    signatureEnvelope: { findFirst: vi.fn() },
    $queryRaw: vi.fn(), $transaction: vi.fn(),
  },
}));
vi.mock("@/auth", () => ({ auth: async () => mocks.session }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
import { GET as templates, POST as saveTemplate } from "@/app/api/document-templates/route";
import { POST as createDraft } from "@/app/api/document-templates/[id]/drafts/route";
import { GET as read, POST as save } from "@/app/api/documents/[id]/content/route";
import { PATCH as setStatus } from "@/app/api/documents/[id]/route";
import { DRAFT_SOURCE, encodeRevision, encodeTemplate } from "@/lib/documents/draft-format";

const context = { params: Promise.resolve({ id: "document-a" }) };
const request = (body?: unknown, path = "/api/documents/document-a/content?workspaceId=workspace-a", origin = "http://localhost") => new NextRequest(`http://localhost${path}`, body === undefined ? {} : {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
});
const operationId = "11111111-1111-4111-8111-111111111111";
const input = { operationId, workspaceId: "workspace-a", expectedVersion: 1, body: "Versão sintética nova" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session = { user: { id: "author-a" } };
  mocks.member.status = "ACTIVE";
  mocks.member.role.permissions.allow = ["documents.view", "documents.edit"];
  mocks.db.workspaceMember.findUnique.mockImplementation(async ({ where }) => where.workspaceId_userId.workspaceId === "workspace-a" && where.workspaceId_userId.userId === "author-a" ? mocks.member : null);
  mocks.db.$transaction.mockImplementation(async fn => fn(mocks.db));
  mocks.db.legalDocument.findFirst.mockResolvedValue({ id: "document-a", currentVersion: 1, status: "DRAFT" });
  mocks.db.documentVersion.findFirst.mockResolvedValue({ version: 1, source: DRAFT_SOURCE, notes: encodeRevision("original") });
  mocks.db.documentVersion.findUnique.mockResolvedValue({ version: 1, source: DRAFT_SOURCE, notes: encodeRevision("original"), sha256: "synthetic" });
  mocks.db.documentTemplate.findUnique.mockResolvedValue(null);
  mocks.db.documentTemplate.findMany.mockResolvedValue([]);
  mocks.db.documentTemplate.findFirst.mockResolvedValue({ id: "template-a", variables: encodeTemplate("Olá {{cliente}}") });
  mocks.db.documentTemplate.create.mockResolvedValue({ id: "template-a", name: "Modelo" });
  mocks.db.legalDocument.create.mockResolvedValue({ id: "document-a", currentVersion: 1 });
});

describe("draft API authorization and immutable revisions", () => {
  it("rejects unauthenticated reads and writes", async () => {
    mocks.session = null;
    expect((await read(request(), context)).status).toBe(401);
    expect((await save(request(input), context)).status).toBe(401);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
  it("rejects another account and a forged workspace", async () => {
    mocks.session = { user: { id: "author-b" } };
    expect((await read(request(), context)).status).toBe(403);
    mocks.session = { user: { id: "author-a" } };
    expect((await save(request({ ...input, workspaceId: "workspace-b" }), context)).status).toBe(403);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
  it("rejects suspended members and view-only writes", async () => {
    mocks.member.status = "SUSPENDED";
    expect((await read(request(), context)).status).toBe(403);
    mocks.member.status = "ACTIVE"; mocks.member.role.permissions.allow = ["documents.view"];
    expect((await save(request(input), context)).status).toBe(403);
  });
  it("passes existing matter/contract confidentiality scope to document lookup", async () => {
    expect((await read(request(), context)).status).toBe(200);
    expect(mocks.db.legalDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: "document-a", AND: [expect.objectContaining({ workspaceId: "workspace-a", AND: expect.any(Array) })],
    } }));
  });
  it("hides inaccessible documents before reading any revision or acquiring a lock", async () => {
    mocks.db.legalDocument.findFirst.mockResolvedValue(null);
    expect((await read(request(), context)).status).toBe(404);
    expect((await save(request(input), context)).status).toBe(404);
    expect(mocks.db.documentVersion.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.$queryRaw).not.toHaveBeenCalled();
  });
  it("saves new immutable revision, resets review status, and attributes author from session", async () => {
    const response = await save(request(input), context);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ version: 2, documentId: "document-a" });
    expect(mocks.db.documentVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ documentId: "document-a", version: 2, createdByUserId: "author-a", notes: encodeRevision(input.body, operationId) }) });
    expect(mocks.db.legalDocument.update).toHaveBeenCalledWith({ where: { id: "document-a" }, data: { currentVersion: 2, status: "DRAFT" } });
    expect(mocks.db.activityLog.create.mock.calls[0][0].data).not.toHaveProperty("body");
    const sql = mocks.db.$queryRaw.mock.calls[0][0].join("?");
    expect(sql).toContain('SELECT id FROM "LegalDocument"');
    expect(sql).not.toContain("advisory");
  });
  it("rejects stale saves without appending a revision", async () => {
    const response = await save(request({ ...input, expectedVersion: 0 }), context);
    expect(response.status).toBe(409);
    expect(mocks.db.documentVersion.create).not.toHaveBeenCalled();
  });
  it("replays a successful save without creating another version or audit event", async () => {
    mocks.db.legalDocument.findFirst.mockResolvedValue({ id: "document-a", currentVersion: 2, status: "DRAFT" });
    mocks.db.documentVersion.findFirst.mockResolvedValue({ version: 2, source: DRAFT_SOURCE, createdByUserId: "author-a", notes: encodeRevision(input.body, operationId), sha256: "same-hash" });
    const response = await save(request(input), context);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ version: 2, sha256: "same-hash" });
    expect(mocks.db.documentVersion.create).not.toHaveBeenCalled();
    expect(mocks.db.activityLog.create).not.toHaveBeenCalled();
    expect((await save(request({ ...input, body: "Changed retry" }), context)).status).toBe(409);
  });
  it("replays template creation without duplicate rows and rejects key reuse with different content", async () => {
    const payload = { operationId, workspaceId: "workspace-a", name: "Modelo", body: "Olá {{cliente}}" };
    mocks.db.documentTemplate.findUnique.mockResolvedValue({ id: "template-a", name: payload.name, workspaceId: "workspace-a", category: DRAFT_SOURCE, variables: encodeTemplate(payload.body) });
    expect((await saveTemplate(request(payload))).status).toBe(201);
    expect(mocks.db.documentTemplate.create).not.toHaveBeenCalled();
    expect(mocks.db.activityLog.create).not.toHaveBeenCalled();
    expect((await saveTemplate(request({ ...payload, body: "Changed" }))).status).toBe(409);
  });
  it("rejects approval and signing of a different version under the document lock", async () => {
    mocks.member.role.permissions.allow.push("documents.sign");
    mocks.db.legalDocument.findFirst.mockResolvedValue({ id: "document-a", currentVersion: 2, status: "DRAFT", matterId: null });
    for (const status of ["APPROVED", "SIGNED"]) {
      const response = await setStatus(request({ workspaceId: "workspace-a", expectedVersion: 1, status }), context);
      expect(response.status).toBe(409);
    }
    expect(mocks.db.legalDocument.update).not.toHaveBeenCalled();
    expect(mocks.db.signatureEnvelope.findFirst).not.toHaveBeenCalled();
  });
  it("rechecks access after acquiring the lock", async () => {
    mocks.db.legalDocument.findFirst.mockResolvedValueOnce({ id: "document-a" }).mockResolvedValueOnce(null);
    expect((await save(request(input), context)).status).toBe(404);
    expect(mocks.db.documentVersion.create).not.toHaveBeenCalled();
  });
  it.each(["APPROVED", "SIGNING", "SIGNED", "ARCHIVED"])("does not change %s documents", async status => {
    mocks.db.legalDocument.findFirst.mockResolvedValue({ id: "document-a", currentVersion: 1, status });
    expect((await save(request(input), context)).status).toBe(409);
    expect(mocks.db.documentVersion.create).not.toHaveBeenCalled();
  });
  it("opens a specific historical version without changing the current pointer", async () => {
    const response = await read(request(undefined, "/api/documents/document-a/content?workspaceId=workspace-a&version=1"), context);
    expect(await response.json()).toMatchObject({ version: 1, body: "original" });
    expect(mocks.db.legalDocument.update).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("reports nonexistent historical version as not found", async () => {
    mocks.db.documentVersion.findUnique.mockResolvedValue(null);
    expect((await read(request(undefined, "/api/documents/document-a/content?workspaceId=workspace-a&version=9"), context)).status).toBe(404);
  });
  it("allows first content on a metadata-only record and rejects overwriting uploads", async () => {
    mocks.db.documentVersion.findFirst.mockResolvedValue(null);
    expect((await save(request({ ...input, expectedVersion: 0 }), context)).status).toBe(201);
    mocks.db.documentVersion.findFirst.mockResolvedValue({ version: 1, source: "UPLOAD", notes: "legacy" });
    expect((await save(request(input), context)).status).toBe(409);
  });
  it("returns a generic response for internal failures without echoing document content", async () => {
    mocks.db.legalDocument.findFirst.mockRejectedValue(new Error("synthetic-private-body database query"));
    const response = await read(request(), context);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("synthetic-private-body");
  });
  it("rejects cross-origin requests, malformed payloads and oversized bodies", async () => {
    expect((await save(request(input, undefined, "https://other.example"), context)).status).toBe(403);
    expect((await save(request({ ...input, createdByUserId: "other" }), context)).status).toBe(400);
    expect((await save(request({ ...input, body: "x".repeat(500_000) }), context)).status).toBe(413);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
  it("lists only valid active editor templates in the authorized workspace", async () => {
    mocks.db.documentTemplate.findMany.mockResolvedValue([{ id: "valid", name: "Modelo", variables: encodeTemplate("Olá {{cliente}}") }, { id: "legacy", variables: [] }]);
    const response = await templates(request());
    expect((await response.json()).templates).toEqual([{ id: "valid", name: "Modelo", format: "lawyermind-template-v1", body: "Olá {{cliente}}", fields: ["cliente"] }]);
    expect(mocks.db.documentTemplate.findMany.mock.calls[0][0].where).toMatchObject({ workspaceId: "workspace-a", active: true });
  });
  it("persists a template, creates its first version, and never trusts a foreign template ID", async () => {
    expect((await saveTemplate(request({ operationId, workspaceId: "workspace-a", name: "Modelo", body: "Olá {{cliente}}" }))).status).toBe(201);
    mocks.db.legalDocument.findFirst.mockResolvedValue(null);
    const payload = { operationId, workspaceId: "workspace-a", name: "Minuta sintética", values: { cliente: "Pessoa fictícia" } };
    expect((await createDraft(request(payload), context)).status).toBe(201);
    expect(mocks.db.legalDocument.create.mock.calls[0][0].data.versions.create).toMatchObject({ version: 1, notes: encodeRevision("Olá Pessoa fictícia", operationId) });
    expect(mocks.db.documentTemplate.findFirst.mock.calls[0][0].where).toMatchObject({ id: "document-a", workspaceId: "workspace-a", active: true });
    mocks.db.documentTemplate.findFirst.mockResolvedValue(null);
    expect((await createDraft(request(payload), context)).status).toBe(404);
  });
  it("rejects invalid template expressions and missing fill values as client errors", async () => {
    expect((await saveTemplate(request({ operationId, workspaceId: "workspace-a", name: "Modelo", body: "{{eval()}}" }))).status).toBe(400);
    expect((await createDraft(request({ operationId, workspaceId: "workspace-a", name: "Minuta", values: {} }), context)).status).toBe(400);
  });
});
