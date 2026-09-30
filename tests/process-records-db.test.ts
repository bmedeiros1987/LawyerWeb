import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { addMatterRecord } from "@/lib/matters/records";

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("Process register", () => {
  let workspaceId: string, userId: string, matterId: string, otherMatterId: string, memberId: string;
  beforeAll(async () => {
    workspaceId = (await prisma.workspace.create({ data: { name: "Register test", slug: `register-${randomUUID()}` } })).id;
    userId = (await prisma.user.create({ data: { name: "Recorder" } })).id;
    const role = await prisma.workspaceRole.create({ data: { workspaceId, name: "Owner", permissions: { allow: ["*"] } } });
    memberId = (await prisma.workspaceMember.create({ data: { workspaceId, userId, roleId: role.id } })).id;
    matterId = (await prisma.matter.create({ data: { workspaceId, title: "Process", secrecy: true } })).id;
    otherMatterId = (await prisma.matter.create({ data: { workspaceId, title: "Other" } })).id;
  });
  afterAll(async () => {
    if (workspaceId) {
      await prisma.matterMovement.deleteMany({ where: { matter: { workspaceId } } });
      await prisma.matter.deleteMany({ where: { workspaceId } });
      await prisma.person.deleteMany({ where: { workspaceId } });
      await prisma.workspace.delete({ where: { id: workspaceId } });
    }
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });
  const save = (input: unknown) => addMatterRecord(userId, workspaceId, matterId, input);
  it("refuses a wildcard member without explicit access to the secret case", async () => {
    await expect(save({ action: "ADD_PARTY", name: "Test party", role: "Autor" })).rejects.toThrow("não encontrado");
    expect(await prisma.person.count({ where: { workspaceId } })).toBe(0);
    await prisma.matterAccess.create({ data: { matterId, memberId } });
  });
  it("reuses an existing client instead of duplicating their contact information", async () => {
    const client = await prisma.client.create({ data: { workspaceId, name: "Existing client" } });
    const input = { action: "ADD_PARTY", clientId: client.id, role: "Autor", side: "CLAIMANT" };
    const first = await save(input), repeat = await save(input);
    expect(first.id).toBe(repeat.id);
    expect(repeat.duplicate).toBe(true);
    await addMatterRecord(userId, workspaceId, otherMatterId, input);
    expect(await prisma.person.count({ where: { workspaceId, clientId: client.id } })).toBe(1);
    expect((await prisma.person.findUniqueOrThrow({ where: { clientId: client.id } })).name).toBeNull();
  });
  it("prevents duplicate named parties without automatically merging homonyms across cases", async () => {
    const input = { action: "ADD_PARTY", name: "Test witness", role: "Testemunha" };
    await save(input);
    await expect(save(input)).rejects.toThrow("já está cadastrada");
    await addMatterRecord(userId, workspaceId, otherMatterId, input);
    expect(await prisma.person.count({ where: { workspaceId, name: input.name } })).toBe(2);
  });
  it("retains phase history and makes retries idempotent", async () => {
    const input = { action: "ADD_PHASE", name: "Conhecimento", kind: "FIRST_INSTANCE", startedAt: "2025-01-01T12:00:00Z", requestId: randomUUID() };
    const first = await save(input), again = await save(input);
    expect(first.id).toBe(again.id);
    await save({ ...input, name: "Recurso", kind: "APPEAL", requestId: randomUUID() });
    expect(await prisma.matterPhase.count({ where: { matterId } })).toBe(2);
    expect((await prisma.matter.findUniqueOrThrow({ where: { id: matterId } })).phase).toBe("Recurso");
    await expect(save({ ...input, name: "Outra fase" })).rejects.toThrow("outra fase");
  });
  it("deduplicates simultaneous movements and never creates a deadline", async () => {
    const input = { action: "ADD_MOVEMENT", title: "Juntada", occurredAt: "2025-02-01T15:00:00Z", description: "Petição recebida", requestId: randomUUID() };
    const results = await Promise.all([save(input), save(input)]);
    expect(results[0].id).toBe(results[1].id);
    expect(await prisma.matterMovement.count({ where: { matterId } })).toBe(1);
    expect(await prisma.deadline.count({ where: { workspaceId } })).toBe(0);
    await expect(save({ ...input, title: "Conteúdo trocado" })).rejects.toThrow("conteúdo diferente");
  });
  it("rejects phase/communication links to another case and future movements", async () => {
    const phase = await addMatterRecord(userId, workspaceId, otherMatterId, { action: "ADD_PHASE", name: "Outra fase", kind: "OTHER", startedAt: "2025-01-01T12:00:00Z", requestId: randomUUID() });
    const input = { action: "ADD_MOVEMENT", title: "Movimento", occurredAt: "2025-02-01T15:00:00Z", requestId: randomUUID() };
    await expect(save({ ...input, phaseId: phase.id })).rejects.toThrow("não pertence");
    await expect(save({ ...input, communicationId: "missing" })).rejects.toThrow("não pertence");
    await expect(save({ ...input, occurredAt: "2099-01-01T12:00:00Z" })).rejects.toThrow("futuro");
  });
});
