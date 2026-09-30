import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";
import { allows, matterScope } from "@/lib/authz/visibility";

const instant = z.iso.datetime({ offset: true }).transform(value => new Date(value));
export const recordInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ADD_PARTY"), clientId: z.string().min(1).optional(), personId: z.string().min(1).optional(),
    name: z.string().trim().min(2).max(260).optional(), kind: z.enum(["INDIVIDUAL", "LEGAL_ENTITY"]).default("INDIVIDUAL"),
    role: z.string().trim().min(2).max(80), side: z.enum(["CLAIMANT", "RESPONDENT", "OTHER"]).default("OTHER") }),
  z.object({ action: z.literal("ADD_PHASE"), name: z.string().trim().min(2).max(160),
    kind: z.enum(["PRE_LITIGATION", "ADMINISTRATIVE", "FIRST_INSTANCE", "APPEAL", "ENFORCEMENT", "OTHER"]),
    number: z.string().trim().max(80).optional(), court: z.string().trim().max(180).optional(), startedAt: instant,
    notes: z.string().trim().max(8000).optional(), makeCurrent: z.boolean().default(true), requestId: z.uuid() }),
  z.object({ action: z.literal("ADD_MOVEMENT"), title: z.string().trim().min(2).max(300),
    description: z.string().trim().max(20000).optional(), occurredAt: instant, phaseId: z.string().min(1).optional(),
    requestId: z.uuid(), communicationId: z.string().min(1).optional(),
    sourceUrl: z.url().refine(value => new URL(value).protocol === "https:", "Use uma fonte HTTPS.").optional() }),
]);

export async function addMatterRecord(userId: string, workspaceId: string, matterId: string, raw: unknown) {
  const input = recordInput.parse(raw);
  const viewer = await requirePermission(userId, workspaceId, P.MATTERS_EDIT);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Matter" WHERE id=${matterId} AND "workspaceId"=${workspaceId} FOR UPDATE`;
    if (!await tx.matter.findFirst({ where: { id: matterId, AND: [matterScope(viewer)] } })) {
      throw Object.assign(new Error("Processo não encontrado."), { status: 404 });
    }
    let entityId: string;
    let summary: string;
    if (input.action === "ADD_PARTY") {
      if ([input.clientId, input.personId, input.name].filter(Boolean).length !== 1) throw new Error("Escolha uma pessoa existente, um cliente ou informe um novo nome.");
      let person;
      if (input.clientId) {
        if (!allows(viewer, P.CLIENTS_VIEW) || !await tx.client.findFirst({ where: { id: input.clientId, workspaceId } })) throw new Error("Cliente inválido ou sem acesso.");
        person = await tx.person.upsert({ where: { clientId: input.clientId }, create: { workspaceId, clientId: input.clientId }, update: {} });
      } else if (input.personId) {
        person = await tx.person.findFirst({ where: { id: input.personId, workspaceId, parties: { some: { matter: matterScope(viewer) } } } });
        if (!person) throw new Error("Pessoa inválida ou sem acesso.");
      } else {
        // Do not merge homonyms across cases. Reuse an explicitly selected person.
        if (await tx.matterParty.findFirst({ where: { matterId, role: { equals: input.role, mode: "insensitive" }, person: { name: { equals: input.name, mode: "insensitive" } } } })) {
          throw Object.assign(new Error("Esta parte já está cadastrada neste papel."), { status: 409 });
        }
        person = await tx.person.create({ data: { workspaceId, name: input.name, kind: input.kind } });
      }
      const existing = await tx.matterParty.findUnique({ where: { matterId_personId_role: { matterId, personId: person.id, role: input.role } } });
      if (existing) return { id: existing.id, duplicate: true };
      const party = await tx.matterParty.create({ data: { matterId, personId: person.id, role: input.role, side: input.side, createdByUserId: userId } });
      entityId = party.id; summary = "Parte vinculada ao processo";
    } else if (input.action === "ADD_PHASE") {
      if (input.startedAt > new Date()) throw new Error("A fase não pode começar no futuro.");
      const contentHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const existing = await tx.matterPhase.findUnique({ where: { matterId_requestId: { matterId, requestId: input.requestId } } });
      if (existing) {
        if (existing.contentHash !== contentHash) throw Object.assign(new Error("Esta solicitação já registrou outra fase."), { status: 409 });
        return { id: existing.id, duplicate: true };
      }
      const phase = await tx.matterPhase.create({ data: { matterId, name: input.name, kind: input.kind,
        number: input.number, court: input.court, startedAt: input.startedAt, notes: input.notes, createdByUserId: userId, requestId: input.requestId, contentHash } });
      if (input.makeCurrent) await tx.matter.update({ where: { id: matterId }, data: { phase: phase.name } });
      entityId = phase.id; summary = "Fase processual registrada";
    } else {
      if (input.occurredAt > new Date()) throw new Error("O andamento não pode ocorrer no futuro.");
      if (input.phaseId && !await tx.matterPhase.findFirst({ where: { id: input.phaseId, matterId } })) throw new Error("A fase não pertence a este processo.");
      const communication = input.communicationId ? await tx.courtCommunication.findFirst({ where: { id: input.communicationId, workspaceId, matterId } }) : null;
      if (input.communicationId && !communication) throw new Error("A comunicação não pertence a este processo.");
      const source = communication ? "COURT_COMMUNICATION" : "MANUAL";
      const externalId = communication?.id ?? input.requestId;
      const data = { matterId, phaseId: input.phaseId, communicationId: communication?.id, title: input.title,
        description: input.description, occurredAt: input.occurredAt, source, externalId,
        sourceUrl: communication?.officialUrl ?? input.sourceUrl };
      const contentHash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
      const existing = await tx.matterMovement.findUnique({ where: { matterId_source_externalId: { matterId, source, externalId } } });
      if (existing) {
        if (existing.contentHash !== contentHash) throw Object.assign(new Error("A origem já foi registrada com conteúdo diferente."), { status: 409 });
        return { id: existing.id, duplicate: true };
      }
      const movement = await tx.matterMovement.create({ data: { ...data, contentHash, createdByUserId: userId } });
      entityId = movement.id; summary = "Andamento processual registrado";
    }
    await tx.activityLog.create({ data: { workspaceId, userId, type: input.action, entityType: "Matter", entityId: matterId,
      summary, metadata: { matterId, recordId: entityId } } });
    return { id: entityId, duplicate: false };
  }, { timeout: 15000 });
}
