import { contractScope, deadlineScope, documentScope, inboxScope, taskScope } from "@/lib/authz/visibility";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, canAccessMatter, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const member = await requireActiveMembership(session.user.id);
    await requirePermission(session.user.id, member.workspaceId, P.MATTERS_VIEW);
    const { id } = await context.params;
    if (!(await canAccessMatter(session.user.id, member.workspaceId, id, P.MATTERS_VIEW))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const matter = await prisma.matter.findFirst({
      where: { id, workspaceId: member.workspaceId },
      include: {
        client: true,
        tasks: { where: taskScope(member), orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 50 },
        deadlines: { where: deadlineScope(member), orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 50 },
        communications: { where: inboxScope(member), orderBy: { receivedAt: "desc" }, take: 50 },
        documents: { where: documentScope(member), orderBy: { updatedAt: "desc" }, take: 50 },
        contracts: { where: contractScope(member), orderBy: { updatedAt: "desc" }, take: 50 },
      },
    });
    if (!matter) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const timeline = [
      ...matter.communications.map((item) => ({ type: "COMMUNICATION", at: item.receivedAt, id: item.id, title: item.title ?? "Comunicação processual", detail: item.source })),
      ...matter.deadlines.map((item) => ({ type: "DEADLINE", at: item.createdAt, id: item.id, title: item.title, detail: item.dueAt?.toISOString() ?? null })),
      ...matter.tasks.map((item) => ({ type: "TASK", at: item.createdAt, id: item.id, title: item.title, detail: item.status })),
      ...matter.documents.map((item) => ({ type: "DOCUMENT", at: item.updatedAt, id: item.id, title: item.name, detail: item.status })),
      ...matter.contracts.map((item) => ({ type: "CONTRACT", at: item.updatedAt, id: item.id, title: item.title, detail: item.status })),
    ].sort((a,b) => b.at.getTime() - a.at.getTime()).slice(0,100);

    return NextResponse.json({ matter, timeline });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status });
  }
}


const patchInput = z.object({
  number: z.string().trim().max(80).optional(),
  internalCode: z.string().trim().max(80).optional(),
  title: z.string().trim().min(2).max(240).optional(),
  type: z.string().trim().max(80).optional(),
  practiceArea: z.string().trim().max(100).optional(),
  court: z.string().trim().max(120).optional(),
  jurisdiction: z.string().trim().max(120).optional(),
  courtUnit: z.string().trim().max(160).optional(),
  phase: z.string().trim().max(120).optional(),
}).strict();

// Edits the registration data of a matter (matters.edit + matter access).
// Deadlines, secrecy and access are not changed here.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const parsed = patchInput.parse(await request.json());
    const member = await requireActiveMembership(session.user.id);
    await requirePermission(session.user.id, member.workspaceId, P.MATTERS_EDIT);
    const { id } = await context.params;
    if (!(await canAccessMatter(session.user.id, member.workspaceId, id, P.MATTERS_EDIT))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const empty = (v?: string) => v === undefined ? undefined : v || null;
    const matter = await prisma.$transaction(async tx => {
      const updated = await tx.matter.update({ where: { id }, data: {
        title: parsed.title, type: parsed.type, number: empty(parsed.number), internalCode: empty(parsed.internalCode),
        practiceArea: empty(parsed.practiceArea), court: empty(parsed.court), jurisdiction: empty(parsed.jurisdiction),
        courtUnit: empty(parsed.courtUnit), phase: empty(parsed.phase),
      } });
      await tx.activityLog.create({ data: { workspaceId: member.workspaceId, userId: session.user!.id, type: "MATTER_UPDATED", entityType: "Matter", entityId: id, summary: `Processo atualizado: ${updated.number ?? updated.title}` } });
      return updated;
    });
    return NextResponse.json({ matter });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status });
  }
}
