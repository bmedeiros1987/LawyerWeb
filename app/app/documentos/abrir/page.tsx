import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";
import { isDesktop } from "@/lib/desktop/env";
import { OpenReview } from "@/components/desktop/open-review";

export const dynamic = "force-dynamic";

// Landing screen for files the OS opened with LawyerMind. Desktop only; importing needs documents.edit.
export default async function Page() {
  if (!isDesktop()) notFound();
  const session = await auth(); if (!session?.user?.id) redirect("/login");
  const member = await getActiveMembership(session.user.id); if (!member) redirect("/app/setup");
  if (!(await memberWithPermission(session.user.id, member.workspaceId, P.DOCUMENTS_EDIT))) {
    return <div className="empty-state"><h2>Acesso restrito</h2><p>Importar arquivos exige permissão para editar documentos.</p></div>;
  }
  const [clients, matters] = await Promise.all([
    prisma.client.findMany({ where: { workspaceId: member.workspaceId, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
    prisma.matter.findMany({ where: { workspaceId: member.workspaceId, OR: [{ secrecy: false }, { access: { some: { memberId: member.id } } }] }, select: { id: true, number: true, title: true }, orderBy: { updatedAt: "desc" }, take: 300 }),
  ]);
  return <OpenReview clients={clients.map(c => ({ id: c.id, label: c.name }))} matters={matters.map(m => ({ id: m.id, label: [m.number, m.title].filter(Boolean).join(" · ") }))} />;
}
