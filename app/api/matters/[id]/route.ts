import { NextResponse } from "next/server";
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
        tasks: { orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 50 },
        deadlines: { orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 50 },
        communications: { orderBy: { receivedAt: "desc" }, take: 50 },
        documents: { orderBy: { updatedAt: "desc" }, take: 50 },
        contracts: { orderBy: { updatedAt: "desc" }, take: 50 },
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
