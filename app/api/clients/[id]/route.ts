import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";

const input = z.object({
  type: z.enum(["INDIVIDUAL", "LEGAL_ENTITY"]).optional(),
  name: z.string().trim().min(2).max(180).optional(),
  legalName: z.string().trim().max(220).optional(),
  cpfCnpj: z.string().trim().max(24).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().max(20000).optional(),
}).strict();

// Edits a client of the caller's active workspace (clients.edit).
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const parsed = input.parse(await request.json());
    const member = await requireActiveMembership(session.user.id);
    await requirePermission(session.user.id, member.workspaceId, P.CLIENTS_EDIT);
    const { id } = await context.params;
    const current = await prisma.client.findFirst({ where: { id, workspaceId: member.workspaceId } });
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const cpfCnpj = parsed.cpfCnpj === undefined ? undefined : parsed.cpfCnpj.replace(/\D/g, "") || null;
    if (cpfCnpj) {
      const duplicate = await prisma.client.findFirst({ where: { workspaceId: member.workspaceId, cpfCnpj, NOT: { id } } });
      if (duplicate) return NextResponse.json({ error: "Já existe um cliente com este CPF/CNPJ.", clientId: duplicate.id }, { status: 409 });
    }
    const client = await prisma.$transaction(async tx => {
      const updated = await tx.client.update({ where: { id }, data: {
        type: parsed.type, name: parsed.name, cpfCnpj,
        legalName: parsed.legalName === undefined ? undefined : parsed.legalName || null,
        email: parsed.email === undefined ? undefined : parsed.email || null,
        phone: parsed.phone === undefined ? undefined : parsed.phone || null,
        notes: parsed.notes === undefined ? undefined : parsed.notes || null,
      } });
      await tx.activityLog.create({ data: { workspaceId: member.workspaceId, userId: session.user!.id, type: "CLIENT_UPDATED", entityType: "Client", entityId: id, summary: `Cliente atualizado: ${updated.name}` } });
      return updated;
    });
    return NextResponse.json({ client });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status });
  }
}
