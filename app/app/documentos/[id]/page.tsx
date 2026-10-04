import { contractScope, documentScope } from "@/lib/authz/visibility";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BriefcaseBusiness, FileCheck2, FileText, PenTool, ScrollText, UserRound } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, canAccessMatter, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";
import { DocumentStatusAction } from "@/components/legal-status-actions";
import { DocumentDraftEditor } from "@/components/document-draft-editor";

export const dynamic="force-dynamic";

const kindNames:Record<string,string>={
  CONTRACT:"Contrato",OPINION:"Parecer",POWER_OF_ATTORNEY:"Procuração",CERTIFICATE:"Certidão",
  CORPORATE_ACT:"Ato societário",TRADEMARK_PATENT:"Marca / patente",PETITION:"Petição",
  NOTICE:"Notificação",MINUTES:"Ata",OTHER:"Outro"
};

export default async function DocumentPage({params}:{params:Promise<{id:string}>}) {
  const session=await auth();if(!session?.user?.id)redirect("/login");
  const member=await getActiveMembership(session.user.id);if(!member)redirect("/app/setup");
  if(!(await memberWithPermission(session.user.id,member.workspaceId,P.DOCUMENTS_VIEW)))notFound();
  const {id}=await params;
  const base=await prisma.legalDocument.findFirst({where:{id,AND:[documentScope(member)]}});
  if(!base)notFound();
  if(base.matterId&&!(await canAccessMatter(session.user.id,member.workspaceId,base.matterId,P.MATTERS_VIEW)))notFound();
  const canEdit=Boolean(await memberWithPermission(session.user.id,member.workspaceId,P.DOCUMENTS_EDIT));

  const [document,history]=await Promise.all([
    prisma.legalDocument.findUnique({where:{id},include:{
      client:true,matter:true,template:true,letterhead:true,
      versions:{orderBy:{version:"desc"},include:{signatureEnvelopes:{orderBy:{requestedAt:"desc"}}}},
      contracts:{where:contractScope(member),orderBy:{updatedAt:"desc"}},
    }}),
    prisma.activityLog.findMany({where:{workspaceId:member.workspaceId,entityType:"LegalDocument",entityId:id},orderBy:{occurredAt:"desc"},take:100}),
  ]);
  if(!document)notFound();
  const signed=document.versions.flatMap(v=>v.signatureEnvelopes).filter(s=>s.status==="SIGNED").length;

  return <div className="page-stack">
    <section className="matter-hero contract-hero">
      <div className="matter-hero-main"><div className="client-big-icon"><FileText size={26}/></div><div><span className="eyebrow">{kindNames[document.kind]??document.kind}</span><h1>{document.name}</h1><p>versão {document.currentVersion}{document.template?" · modelo "+document.template.name:""}</p></div></div>
      <div className="matter-hero-meta">
        <div><span>Cliente</span><strong>{document.client?.name??"—"}</strong></div>
        <div><span>Versões com arquivo</span><strong>{document.versions.length}</strong></div>
        <div><span>Status</span>{canEdit?<DocumentStatusAction id={document.id} workspaceId={member.workspaceId} status={document.status} currentVersion={document.currentVersion}/>:<strong>{document.status}</strong>}</div>
      </div>
    </section>

    <section className="metric-grid three">
      <article className="metric-card"><div className="metric-icon"><FileText size={19}/></div><span>Versão atual</span><strong>{document.currentVersion}</strong><small>{document.versions.length?"arquivo versionado":"registro ainda sem arquivo"}</small></article>
      <article className="metric-card"><div className="metric-icon"><PenTool size={19}/></div><span>Assinaturas</span><strong>{signed}</strong><small>evidências concluídas</small></article>
      <article className="metric-card"><div className="metric-icon"><FileCheck2 size={19}/></div><span>Contratos vinculados</span><strong>{document.contracts.length}</strong><small>usando este registro</small></article>
    </section>

    <DocumentDraftEditor userId={session.user.id} documentId={document.id} workspaceId={member.workspaceId} canEdit={canEdit} serverVersion={document.currentVersion} serverStatus={document.status}/>
    <section className="contract-layout">
      <article className="panel panel-wide">
        <div className="panel-heading"><div><span className="eyebrow">Versões</span><h2>Histórico documental</h2></div></div>
        {document.versions.length===0?<div className="storage-placeholder"><FileText size={24}/><div><strong>Registro jurídico criado; arquivo ainda não anexado.</strong><span>O upload será liberado quando o storage criptografado estiver configurado. Os arquivos terão acesso restrito e histórico de versões.</span></div></div>:
        <div className="simple-list">{document.versions.map(v=><div key={v.id}><span className="table-icon"><FileText size={15}/></span><div><strong>Versão {v.version}{v.originalName?" · "+v.originalName:""}</strong><small>{v.mimeType??"arquivo"} · {v.createdAt.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}</small></div><span>{v.sha256?"hash ✓":""}</span></div>)}</div>}

        <div className="panel-heading history-subhead"><div><span className="eyebrow">Auditoria</span><h2>Atividade</h2></div></div>
        {history.length===0?<div className="mini-empty">Nenhum evento adicional registrado.</div>:<div className="timeline-list">{history.map(h=><div className="timeline-row" key={h.id}><div className="timeline-icon"><FileText size={16}/></div><div className="timeline-copy"><strong>{h.summary}</strong><span>{h.type}</span></div><time>{h.occurredAt.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}</time></div>)}</div>}
      </article>

      <aside className="matter-side">
        <article className="panel"><div className="panel-heading"><div><span className="eyebrow">Vínculos</span><h2>Contexto</h2></div></div>
          <div className="simple-list compact-links">
            {document.client?<Link href={"/app/clientes/"+document.client.id}><span className="table-icon"><UserRound size={15}/></span><div><strong>{document.client.name}</strong><small>Cliente</small></div><span>›</span></Link>:null}
            {document.matter?<Link href={"/app/processos/"+document.matter.id}><span className="table-icon"><BriefcaseBusiness size={15}/></span><div><strong>{document.matter.number??document.matter.title}</strong><small>Processo / assunto</small></div><span>›</span></Link>:null}
            {document.contracts.slice(0,5).map(c=><Link href={"/app/contratos/"+c.id} key={c.id}><span className="table-icon"><ScrollText size={15}/></span><div><strong>{c.title}</strong><small>Contrato vinculado</small></div><span>›</span></Link>)}
          </div>
          <dl className="detail-list document-meta">
            <div><dt>Papel timbrado</dt><dd>{document.letterhead?.name??"—"}</dd></div>
            <div><dt>Modelo</dt><dd>{document.template?.name??"—"}</dd></div>
            <div><dt>Tipo</dt><dd>{kindNames[document.kind]??document.kind}</dd></div>
          </dl>
        </article>
      </aside>
    </section>
  </div>;
}
