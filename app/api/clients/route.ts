import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";

const input = z.object({
  workspaceId: z.string().optional(),
  type: z.enum(["INDIVIDUAL","LEGAL_ENTITY"]).default("LEGAL_ENTITY"),
  name: z.string().trim().min(2).max(180),
  legalName: z.string().trim().max(220).optional(),
  cpfCnpj: z.string().trim().max(24).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().max(20000).optional(),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const requested = request.nextUrl.searchParams.get("workspaceId");
    const member = await requireActiveMembership(session.user.id, requested);
    await requirePermission(session.user.id, member.workspaceId, P.CLIENTS_VIEW);
    const q = request.nextUrl.searchParams.get("q")?.trim();
    const clients = await prisma.client.findMany({
      where: {
        workspaceId: member.workspaceId,
        ...(q ? { OR: [
          { name: { contains: q, mode: "insensitive" } },
          { legalName: { contains: q, mode: "insensitive" } },
          { cpfCnpj: { contains: q.replace(/\D/g, "") } },
          { email: { contains: q, mode: "insensitive" } },
        ] } : {}),
      },
      include: { _count: { select: { matters: true, documents: true, contracts: true } } },
      orderBy: { name: "asc" },
      take: 200,
    });
    return NextResponse.json({ workspaceId: member.workspaceId, clients });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const parsed = input.parse(await request.json());
    const member = await requireActiveMembership(session.user.id, parsed.workspaceId);
    await requirePermission(session.user.id, member.workspaceId, P.CLIENTS_EDIT);
    const cpfCnpj = parsed.cpfCnpj?.replace(/\D/g, "") || null;

    if (cpfCnpj) {
      const duplicate = await prisma.client.findFirst({ where: { workspaceId: member.workspaceId, cpfCnpj } });
      if (duplicate) return NextResponse.json({ error: "Já existe um cliente com este CPF/CNPJ.", clientId: duplicate.id }, { status: 409 });
    }

    const client = await prisma.$transaction(async (tx) => {
      const created = await tx.client.create({
        data: {
          workspaceId: member.workspaceId,
          type: parsed.type,
          name: parsed.name,
          legalName: parsed.legalName || null,
          cpfCnpj,
          email: parsed.email || null,
          phone: parsed.phone || null,
          notes: parsed.notes || null,
        },
      });
      await tx.activityLog.create({
        data: {
          workspaceId: member.workspaceId,
          userId: session.user.id,
          type: "CLIENT_CREATED",
          entityType: "Client",
          entityId: created.id,
          summary: `Cliente cadastrado: ${created.name}`,
        },
      });
      return created;
    });
    return NextResponse.json({ client }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status });
  }
}
