import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock3, FileDiff, LockKeyhole, ScrollText, Search, Signature } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";
import { QuickContractForm } from "@/components/legal-documents-quick-create";

export const dynamic="force-dynamic";

function statusLabel(status:string){
  return status==="DRAFT"?"Minuta":status==="NEGOTIATION"?"Negociação":status==="REVIEW"?"Revisão":status==="SIGNING"?"Assinatura":status==="ACTIVE"?"Ativo":status==="EXPIRING"?"Vencendo":status==="EXPIRED"?"Vencido":status==="TERMINATED"?"Encerrado":"Arquivado";
}

export default async function Page({searchParams}:{searchParams:Promise<{q?:string}>}) {
  const session=await auth(); if(!session?.user?.id) redirect("/login");
  const member=await getActiveMembership(session.user.id); if(!member) redirect("/app/setup");
  if(!(await memberWithPermission(session.user.id,member.workspaceId,P.CONTRACTS_VIEW))) {
    return <div className="empty-state"><LockKeyhole size={28}/><h2>Acesso restrito</h2><p>Seu perfil não possui permissão para consultar contratos.</p></div>;
  }
  const canEdit=Boolean(await memberWithPermission(session.user.id,member.workspaceId,P.CONTRACTS_EDIT));
  const {q=""}=await searchParams; const search=q.trim(); const now=new Date(); const in60d=new Date(now.getTime()+60*24*60*60*1000);
  const visibility={OR:[{matterId:null},{matter:{secrecy:false}},{matter:{access:{some:{memberId:member.id}}}}]};

  const [contracts,clients,matters,members]=await Promise.all([
    prisma.contract.findMany({
      where:{workspaceId:member.workspaceId,AND:[
        visibility,
        ...(search?[{OR:[
          {title:{contains:search,mode:"insensitive" as const}},
          {contractType:{contains:search,mode:"insensitive" as const}},
          {counterparty:{contains:search,mode:"insensitive" as const}},
          {client:{name:{contains:search,mode:"insensitive" as const}}},
          {matter:{number:{contains:search,mode:"insensitive" as const}}},
        ]}]:[]),
      ]},
      include:{client:{select:{id:true,name:true}},matter:{select:{id:true,number:true,title:true}},document:{select:{id:true,name:true,currentVersion:true}}},
      orderBy:[{expiresAt:"asc"},{updatedAt:"desc"}],take:300,
    }),
    prisma.client.findMany({where:{workspaceId:member.workspaceId,status:"ACTIVE"},select:{id:true,name:true},orderBy:{name:"asc"},take:300}),
    prisma.matter.findMany({where:{workspaceId:member.workspaceId,OR:[{secrecy:false},{access:{some:{memberId:member.id}}}]},select:{id:true,number:true,title:true},orderBy:{updatedAt:"desc"},take:300}),
    prisma.workspaceMember.findMany({where:{workspaceId:member.workspaceId,status:"ACTIVE"},include:{user:{select:{name:true,email:true}}},orderBy:{createdAt:"asc"}}),
  ]);

  const review=contracts.filter(c=>["NEGOTIATION","REVIEW"].includes(c.status)).length;
  const signing=contracts.filter(c=>c.status==="SIGNING").length;
  const expiring=contracts.filter(c=>c.expiresAt&&c.expiresAt>=now&&c.expiresAt<=in60d&&["ACTIVE","EXPIRING"].includes(c.status)).length;

  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">MBLZ Contracts</span><h1>Contratos</h1><p>Minuta, revisão, vigência, aviso prévio, renovação e assinatura em um único ciclo.</p></div>
      {canEdit&&<QuickContractForm workspaceId={member.workspaceId} clients={clients} matters={matters.map(m=>({id:m.id,label:[m.number,m.title].filter(Boolean).join(" · ")}))} members={members.map(m=>({userId:m.userId,name:m.user.name??m.user.email??"Usuário"}))}/>}
    </section>

    <section className="metric-grid three">
      <article className="metric-card"><div className="metric-icon"><FileDiff size={19}/></div><span>Em negociação/revisão</span><strong>{review}</strong><small>aguardando definição</small></article>
      <article className="metric-card"><div className="metric-icon"><Signature size={19}/></div><span>Em assinatura</span><strong>{signing}</strong><small>aguardando conclusão</small></article>
      <article className={"metric-card "+(expiring?"priority":"")}><div className="metric-icon"><Clock3 size={19}/></div><span>Vencem em 60 dias</span><strong>{expiring}</strong><small>{expiring?"revisar aviso prévio":"nenhum agora"}</small></article>
    </section>

    <form className="toolbar-card" action="/app/contratos" method="get"><div className="search-field"><Search size={17}/><input name="q" defaultValue={search} placeholder="Contrato, tipo, cliente, contraparte ou processo"/></div></form>

    {contracts.length===0?<div className="empty-state"><ScrollText size={28}/><h2>{search?"Nenhum contrato encontrado":"Nenhum contrato cadastrado"}</h2><p>Cadastre contratos e aditivos para controlar revisão, vigência, renovação e documentação relacionada.</p></div>:
    <section className="table-card"><div className="table-head contracts"><span>Contrato</span><span>Cliente / contraparte</span><span>Vigência</span><span>Status</span><span/></div>{contracts.map(c=>{
      const alertDate=c.expiresAt&&c.noticeDays!=null?new Date(c.expiresAt.getTime()-c.noticeDays*24*60*60*1000):null;
      const attention=Boolean((c.expiresAt&&c.expiresAt<now)|| (alertDate&&alertDate<=now&&c.expiresAt&&c.expiresAt>=now));
      return <Link className="table-row contracts" href={"/app/contratos/"+c.id} key={c.id}>
        <div className="matter-name"><span className="table-icon"><ScrollText size={16}/></span><div><strong>{c.title}</strong><small>{c.contractType}{c.document?" · v"+c.document.currentVersion:""}</small></div></div>
        <span>{c.client?.name??c.counterparty??"Sem vínculo"}</span>
        <span>{c.expiresAt?c.expiresAt.toLocaleDateString("pt-BR")+(c.noticeDays!=null?" · aviso "+c.noticeDays+"d":""):"Sem vencimento"}</span>
        <span className={"status-pill "+(attention?"danger":c.status==="ACTIVE"?"success":"quiet")}>{attention&&c.expiresAt&&c.expiresAt<now?"Vencido":statusLabel(c.status)}</span>
        <span>›</span>
      </Link>
    })}</section>}

    <section className="document-grid">
      <article className="folder-card"><Signature size={21}/><strong>Assinaturas</strong><span>metadados e evidências de assinatura vinculadas ao documento</span></article>
      <article className="folder-card"><Clock3 size={21}/><strong>Vigências</strong><span>renovação, aviso prévio e vencimentos entram no Pulse</span></article>
      <article className="folder-card"><FileDiff size={21}/><strong>Redline</strong><span>comparação entre versões entra após o storage seguro</span></article>
    </section>
  </div>;
}
