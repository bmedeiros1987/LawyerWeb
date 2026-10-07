import { contractScope, documentScope } from "@/lib/authz/visibility";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, FolderOpen, LockKeyhole, Search } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";
import { QuickLegalDocumentForm } from "@/components/legal-documents-quick-create";
import { DesktopImportPanel } from "@/components/desktop/document-import";

export const dynamic="force-dynamic";

const kindNames:Record<string,string>={
  CONTRACT:"Contrato",OPINION:"Parecer",POWER_OF_ATTORNEY:"Procuração",CERTIFICATE:"Certidão",
  CORPORATE_ACT:"Ato societário",TRADEMARK_PATENT:"Marca / patente",PETITION:"Petição",
  NOTICE:"Notificação",MINUTES:"Ata",OTHER:"Outro"
};
const statusNames:Record<string,string>={DRAFT:"Minuta",IN_REVIEW:"Em revisão",APPROVED:"Aprovado",SIGNING:"Assinatura",SIGNED:"Assinado",ARCHIVED:"Arquivado"};

export default async function Page({searchParams}:{searchParams:Promise<{q?:string}>}) {
  const session=await auth(); if(!session?.user?.id) redirect("/login");
  const member=await getActiveMembership(session.user.id); if(!member) redirect("/app/setup");
  if(!(await memberWithPermission(session.user.id,member.workspaceId,P.DOCUMENTS_VIEW))) {
    return <div className="empty-state"><LockKeyhole size={28}/><h2>Acesso restrito</h2><p>Seu perfil não possui permissão para consultar documentos.</p></div>;
  }
  const canEdit=Boolean(await memberWithPermission(session.user.id,member.workspaceId,P.DOCUMENTS_EDIT));
  const {q=""}=await searchParams; const search=q.trim();
  const visibility=documentScope(member);

  const [documents,clients,matters,templateCount,letterheadCount,signedCount]=await Promise.all([
    prisma.legalDocument.findMany({
      where:{workspaceId:member.workspaceId,AND:[
        visibility,
        ...(search?[{OR:[
          {name:{contains:search,mode:"insensitive" as const}},
          {kind:{contains:search,mode:"insensitive" as const}},
          {client:{name:{contains:search,mode:"insensitive" as const}}},
          {matter:{number:{contains:search,mode:"insensitive" as const}}},
          {matter:{title:{contains:search,mode:"insensitive" as const}}},
        ]}]:[]),
      ]},
      include:{client:{select:{id:true,name:true}},matter:{select:{id:true,number:true,title:true}},_count:{select:{versions:true,contracts:{where:contractScope(member)}}}},
      orderBy:{updatedAt:"desc"},take:300,
    }),
    prisma.client.findMany({where:{workspaceId:member.workspaceId,status:"ACTIVE"},select:{id:true,name:true},orderBy:{name:"asc"},take:300}),
    prisma.matter.findMany({where:{workspaceId:member.workspaceId,OR:[{secrecy:false},{access:{some:{memberId:member.id}}}]},select:{id:true,number:true,title:true},orderBy:{updatedAt:"desc"},take:300}),
    prisma.documentTemplate.count({where:{workspaceId:member.workspaceId,active:true}}),
    prisma.letterhead.count({where:{workspaceId:member.workspaceId}}),
    prisma.legalDocument.count({where:{workspaceId:member.workspaceId,status:"SIGNED",AND:[visibility]}}),
  ]);

  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">MBLZ Files</span><h1>Documentos jurídicos</h1><p>Contratos, pareceres, procurações, certidões, atos societários, petições e seus vínculos.</p></div>
      {canEdit&&<QuickLegalDocumentForm workspaceId={member.workspaceId} clients={clients} matters={matters.map(m=>({id:m.id,label:[m.number,m.title].filter(Boolean).join(" · ")}))}/>}
    </section>

    {canEdit&&process.env.MBLZ_DESKTOP==="1"&&<DesktopImportPanel clients={clients.map(c=>({id:c.id,label:c.name}))} matters={matters.map(m=>({id:m.id,label:[m.number,m.title].filter(Boolean).join(" · ")}))}/>}

    <form className="toolbar-card" action="/app/documentos" method="get"><div className="search-field"><Search size={17}/><input name="q" defaultValue={search} placeholder="Nome, tipo, processo ou cliente"/></div></form>

    <section className="document-grid">
      <article className="folder-card"><FolderOpen size={21}/><strong>Modelos do escritório</strong><span>{templateCount} modelos ativos</span></article>
      <article className="folder-card"><FolderOpen size={21}/><strong>Papel timbrado</strong><span>{letterheadCount} configurações</span></article>
      <article className="folder-card"><FolderOpen size={21}/><strong>Assinados</strong><span>{signedCount} registros assinados</span></article>
    </section>

    {documents.length===0?<div className="empty-state"><FileText size={28}/><h2>{search?"Nenhum documento encontrado":"Nenhum documento jurídico cadastrado"}</h2><p>Crie o registro do documento agora; arquivo, versões e assinatura serão adicionados sobre o mesmo registro.</p></div>:
    <section className="table-card"><div className="table-head legal-docs"><span>Documento</span><span>Tipo</span><span>Vínculo</span><span>Status</span><span/></div>{documents.map(d=><Link className="table-row legal-docs" href={"/app/documentos/"+d.id} key={d.id}>
      <div className="matter-name"><span className="table-icon"><FileText size={16}/></span><div><strong>{d.name}</strong><small>versão {d.currentVersion} · atualizado {d.updatedAt.toLocaleDateString("pt-BR")}</small></div></div>
      <span>{kindNames[d.kind]??d.kind}</span>
      <span>{d.matter?(d.matter.number??d.matter.title):d.client?.name??"Sem vínculo"}</span>
      <span className={"status-pill "+(d.status==="SIGNED"?"success":d.status==="IN_REVIEW"?"":"quiet")}>{statusNames[d.status]??d.status}</span>
      <span>›</span>
    </Link>)}</section>}
  </div>;
}
