import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { documentScope, type Viewer } from "@/lib/authz/visibility";
import { decodeRevision, decodeTemplate, DRAFT_SOURCE, encodeRevision, encodeTemplate, fillTemplate, revisionOperation, TEMPLATE_CATEGORY } from "./draft-format";

export class DraftError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function listTemplates(viewer: Viewer) {
  const rows = await prisma.documentTemplate.findMany({
    where: { workspaceId: viewer.workspaceId, category: TEMPLATE_CATEGORY, active: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100,
    select: { id: true, name: true, variables: true },
  });
  return rows.flatMap(row => {
    const content = decodeTemplate(row.variables);
    return content ? [{ id: row.id, name: row.name, ...content }] : [];
  });
}

function operationKey(viewer: Viewer, operationId: string, kind: string) {
  return createHash("sha256").update(JSON.stringify([kind, viewer.workspaceId, viewer.userId, operationId])).digest("hex");
}

export async function saveTemplate(viewer: Viewer, name: string, body: string, operationId: string) {
  let variables: ReturnType<typeof encodeTemplate>;
  try { variables = encodeTemplate(body); } catch { throw new DraftError("Modelo inválido. Use campos no formato {{nome_do_campo}}.", 400); }
  return prisma.$transaction(async tx => {
    // Short workspace lock serializes create retries without introducing new tables/columns.
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${viewer.workspaceId} FOR UPDATE`;
    const id = operationKey(viewer, operationId, "template");
    const existing = await tx.documentTemplate.findUnique({ where: { id } });
    if (existing) {
      if (existing.workspaceId !== viewer.workspaceId || existing.category !== TEMPLATE_CATEGORY || existing.name !== name || decodeTemplate(existing.variables)?.body !== body) throw new DraftError("Operação já utilizada com outro conteúdo.", 409);
      return { id: existing.id, name: existing.name };
    }
    const template = await tx.documentTemplate.create({ data: {
      id, workspaceId: viewer.workspaceId, name, category: TEMPLATE_CATEGORY, variables,
    }, select: { id: true, name: true } });
    await tx.activityLog.create({ data: {
      workspaceId: viewer.workspaceId, userId: viewer.userId, type: "DOCUMENT_TEMPLATE_CREATED",
      entityType: "DocumentTemplate", entityId: template.id, summary: "Modelo de texto salvo",
    } });
    return template;
  });
}

function versionData(body: string, userId: string, operationId: string) {
  return {
    source: DRAFT_SOURCE, mimeType: "text/plain; charset=utf-8", notes: encodeRevision(body, operationId),
    sha256: createHash("sha256").update(body, "utf8").digest("hex"), createdByUserId: userId,
  };
}

export async function createDraft(viewer: Viewer, templateId: string, name: string, values: Record<string, string>, operationId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${viewer.workspaceId} FOR UPDATE`;
    const template = await tx.documentTemplate.findFirst({ where: {
      id: templateId, workspaceId: viewer.workspaceId, category: TEMPLATE_CATEGORY, active: true,
    } });
    if (!template) throw new DraftError("Modelo não encontrado.", 404);
    const content = decodeTemplate(template.variables);
    if (!content) throw new DraftError("Modelo não compatível.", 409);
    let body: string;
    try { body = fillTemplate(content.body, values); } catch { throw new DraftError("Preencha todos os campos do modelo e respeite o limite de texto.", 400); }
    const id = operationKey(viewer, operationId, "draft");
    const existing = await tx.legalDocument.findFirst({ where: { id, AND: [documentScope(viewer)] }, include: { versions: { where: { version: 1 } } } });
    if (existing) {
      if (existing.templateId !== templateId || existing.name !== name || !existing.versions[0] || decodeRevision(existing.versions[0]) !== body) throw new DraftError("Operação já utilizada com outro conteúdo.", 409);
      return { id: existing.id, currentVersion: existing.currentVersion };
    }
    const document = await tx.legalDocument.create({ data: {
      id, workspaceId: viewer.workspaceId, name, templateId, status: "DRAFT", currentVersion: 1,
      createdByUserId: viewer.userId, versions: { create: { version: 1, ...versionData(body, viewer.userId, operationId) } },
    }, select: { id: true, currentVersion: true } });
    await tx.activityLog.create({ data: {
      workspaceId: viewer.workspaceId, userId: viewer.userId, type: "DOCUMENT_DRAFT_CREATED",
      entityType: "LegalDocument", entityId: document.id, summary: "Minuta criada a partir de modelo",
      metadata: { templateId, version: 1 },
    } });
    return document;
  });
}

export async function readDraft(viewer: Viewer, documentId: string, version?: number) {
  const document = await prisma.legalDocument.findFirst({ where: { id: documentId, AND: [documentScope(viewer)] },
    select: { id: true, currentVersion: true, status: true } });
  if (!document) throw new DraftError("Documento não encontrado.", 404);
  const saved = await prisma.documentVersion.findUnique({ where: { documentId_version: {
    documentId, version: version ?? document.currentVersion,
  } } });
  if (!saved) {
    if (version !== undefined) throw new DraftError("Versão não encontrada.", 404);
    if (await prisma.documentVersion.count({ where: { documentId } })) throw new DraftError("Histórico inconsistente. Edição indisponível.", 409);
    return { documentId, currentVersion: document.currentVersion, version: 0, body: null, status: document.status };
  }
  const body = decodeRevision(saved);
  if (body === null) throw new DraftError("Esta versão não contém uma minuta de texto editável.", 409);
  return { documentId, currentVersion: document.currentVersion, version: saved.version, body, status: document.status, sha256: saved.sha256 };
}

export async function saveRevision(viewer: Viewer, documentId: string, expectedVersion: number, body: string, operationId: string) {
  const data = versionData(body, viewer.userId, operationId);
  return prisma.$transaction(async tx => {
    // Select a scalar instead of a void-returning advisory lock. Recheck visibility after the lock.
    const accessible = await tx.legalDocument.findFirst({ where: { id: documentId, AND: [documentScope(viewer)] }, select: { id: true } });
    if (!accessible) throw new DraftError("Documento não encontrado.", 404);
    await tx.$queryRaw`SELECT id FROM "LegalDocument" WHERE id=${documentId} AND "workspaceId"=${viewer.workspaceId} FOR UPDATE`;
    const document = await tx.legalDocument.findFirst({ where: { id: documentId, AND: [documentScope(viewer)] } });
    if (!document) throw new DraftError("Documento não encontrado.", 404);
    if (!["DRAFT", "IN_REVIEW"].includes(document.status)) throw new DraftError("Apenas minutas e documentos em revisão podem ser editados.", 409);
    const latest = await tx.documentVersion.findFirst({ where: { documentId }, orderBy: { version: "desc" } });
    const current = latest?.version ?? 0;
    if (latest && revisionOperation(latest) === operationId) {
      if (latest.createdByUserId !== viewer.userId || decodeRevision(latest) !== body || current !== expectedVersion + 1 || current !== document.currentVersion) throw new DraftError("Operação já utilizada com outro conteúdo.", 409);
      return { documentId, version: current, sha256: latest.sha256 };
    }
    if (current !== expectedVersion || (latest && current !== document.currentVersion)) {
      throw new DraftError("O documento mudou. Reabra a versão atual antes de salvar.", 409);
    }
    if (latest && decodeRevision(latest) === null) throw new DraftError("O arquivo atual não é uma minuta de texto editável.", 409);
    const version = current + 1;
    await tx.documentVersion.create({ data: { documentId, version, ...data } });
    await tx.legalDocument.update({ where: { id: documentId }, data: { currentVersion: version, status: "DRAFT" } });
    await tx.activityLog.create({ data: {
      workspaceId: viewer.workspaceId, userId: viewer.userId, type: "DOCUMENT_VERSION_CREATED",
      entityType: "LegalDocument", entityId: documentId, summary: "Nova versão de minuta salva",
      metadata: { version },
    } });
    return { documentId, version, sha256: data.sha256 };
  });
}
