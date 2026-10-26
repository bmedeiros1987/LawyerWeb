import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { P, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";
import { isDesktop } from "@/lib/desktop/env";
import { CompareView } from "@/components/compare/compare-view";

export const dynamic = "force-dynamic";

// Side-by-side comparison, or one pane per window (?painel=esq|dir) for two monitors. Desktop only; every
// version is authorized again by the API (documents.view, workspace, document scope, confidential matters).
export default async function Page({ searchParams }: { searchParams: Promise<{ esq?: string; dir?: string; painel?: string }> }) {
  if (!isDesktop()) notFound();
  const session = await auth(); if (!session?.user?.id) redirect("/login");
  const member = await getActiveMembership(session.user.id); if (!member) redirect("/app/setup");
  if (!(await memberWithPermission(session.user.id, member.workspaceId, P.DOCUMENTS_VIEW))) return <div className="empty-state"><h2>Acesso restrito</h2><p>Comparar documentos exige permissão para consultá-los.</p></div>;
  const q = await searchParams, id = (v?: string) => (v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : undefined);
  const pane = q.painel === "esq" || q.painel === "dir" ? q.painel : "ambos";
  return <CompareView left={id(q.esq)} right={id(q.dir)} pane={pane} />;
}
