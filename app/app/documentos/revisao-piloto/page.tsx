import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { getActiveMembership } from "@/lib/workspace/context";
import { memberWithPermission, P } from "@/lib/authz/permissions";
import { ReviewPilot } from "@/components/document-review/pilot";
export default async function Page() {
  if (process.env.MBLZ_DESKTOP !== "1") notFound();
  const session = await auth(); if (!session?.user?.id) redirect("/login");
  const member = await getActiveMembership(session.user.id); if (!member) redirect("/app/setup");
  if (!await memberWithPermission(session.user.id, member.workspaceId, P.DOCUMENTS_EDIT)) return <div className="empty-state"><h2>Acesso restrito</h2><p>Revisão exige permissão para editar documentos.</p></div>;
  return <ReviewPilot />;
}
