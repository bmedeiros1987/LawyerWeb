import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_ROLES } from "@/lib/workspace/default-roles";

const input = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/).optional(),
  timezone: z.string().trim().min(3).max(80).default("America/Sao_Paulo"),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const parsed = input.parse(await request.json());
    const baseSlug = parsed.slug ?? parsed.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;

    const workspace = await prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({ data: { name: parsed.name, slug, timezone: parsed.timezone } });
      await tx.workspaceRole.createMany({
        data: DEFAULT_ROLES.map((r) => ({ workspaceId: ws.id, key: r.key, name: r.name, level: r.level, permissions: { allow: [...r.allow] }, isSystem: true })),
      });
      const owner = await tx.workspaceRole.findFirstOrThrow({ where: { workspaceId: ws.id, key: "OWNER" } });
      await tx.workspaceMember.create({ data: { workspaceId: ws.id, userId: session.user.id, roleId: owner.id, status: "ACTIVE", jobTitle: "Proprietário" } });
      await tx.deadlinePolicy.create({
        data: {
          workspaceId: ws.id,
          name: "Proteção de prazos padrão",
          isDefault: true,
          requireReviewer: true,
          internalBufferHours: 24,
          reminderSchedule: { stages: ["7d", "3d", "1d", "6h", "2h"] },
          escalationPolicy: { at: "2h", roles: ["OWNER", "MANAGING_PARTNER", "LEGAL_OPS"] },
        },
      });
      await tx.activityLog.create({
        data: { workspaceId: ws.id, userId: session.user.id, type: "WORKSPACE_CREATED", entityType: "Workspace", entityId: ws.id, summary: "Workspace criado" },
      });
      return ws;
    });
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}
