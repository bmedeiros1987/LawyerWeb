import { notFound, redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { auth } from "@/auth";
import { P, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";
import { pdfToolsExperimentalEnabled } from "@/lib/pdf-tools/flag";

export const dynamic="force-dynamic";

export default async function Page() {
  if(!pdfToolsExperimentalEnabled()) notFound();
  const session=await auth(); if(!session?.user?.id) redirect("/login");
  const member=await getActiveMembership(session.user.id); if(!member) redirect("/app/setup");
  if(!(await memberWithPermission(session.user.id,member.workspaceId,P.DOCUMENTS_VIEW))) notFound();

  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">MBLZ Files · experimental</span><h1>Ferramentas PDF</h1><p>Central de edição, páginas, conversão, OCR, formulários e assinaturas de PDF.</p></div></section>
    <div className="empty-state"><FileText size={28}/><h2>Indisponível nesta versão</h2><p>Nenhum motor de PDF está instalado. Esta página não lê, envia nem altera arquivos. Seus documentos continuam em Documentos, sem mudanças.</p></div>
  </div>;
}
