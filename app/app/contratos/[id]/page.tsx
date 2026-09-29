import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BriefcaseBusiness, CalendarClock, FileText, Landmark, ScrollText, ShieldCheck, UserRound } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, canAccessMatter, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";
import { ContractStatusAction } from "@/components/legal-status-actions";

export const dynamic="force-dynamic";

function money(value:unknown,currency:string){
  if(value==null)return "—";
  const n=Number(value); if(Number.isNaN(n))return "—";
  return new Intl.NumberFormat("pt-BR",{style:"currency",currency}).format(n);
}
function fmt(date:Date|null){return date?date.toLocaleDateString("pt-BR"):"—"}

export default async function ContractPage({params}:{params:Promise<{id:string}>}) {
  const session=await auth(); if(!session?.user?.id)redirect("/login");
  const member=await getActiveMembership(session.user.id); if(!member)redirect("/app/setup");
  if(!(await memberWithPermission(session.user.id,member.workspaceId,P.CONTRACTS_VIEW)))notFound();
  const {id}=await params;
  const base=await prisma.contract.findFirst({where:{id,workspaceId:member.workspaceId}});
  if(!base)notFound();
  if(base.matterId&&!(await canAccessMatter(session.user.id,member.workspaceId,base.matterId,P.MATTERS_VIEW)))notFound();
  const canEdit=Boolean(await memberWithPermission(session.user.id,member.workspaceId,P.CONTRACTS_EDIT));

  const [contract,history,responsible]=await Promise.all([
    prisma.contract.findUnique({where:{id},include:{
      client:true,matter:true,
      document:{include:{versions:{orderBy:{version:"desc"},take:20}}},
    }}),
    prisma.activityLog.findMany({where:{workspaceId:member.workspaceId,entityType:"Contract",entityId:id},orderBy:{occurredAt:"desc"},take:100}),
    base.responsibleUserId?prisma.user.findUnique({where:{id:base.responsibleUserId},select:{name:true,email:true}}):Promise.resolve(null),
  ]);
  if(!contract)notFound();

  const now=new Date();
  const noticeDate=contract.expiresAt&&contract.noticeDays!=null?new Date(contract.expiresAt.getTime()-contract.noticeDays*24*60*60*1000):null;
  const noticeReached=Boolean(noticeDate&&noticeDate<=now&&contract.expiresAt&&contract.expiresAt>=now);
  const expired=Boolean(contract.expiresAt&&contract.expiresAt<now);

  return <div className="page-stack">
    <section className="matter-hero contract-hero">
      <div className="matter-hero-main">
        <div className="client-big-icon"><ScrollText size={26}/></div>
        <div><span className="eyebrow">Contrato</span><h1>{contract.title}</h1><p>{contract.contractType}{contract.counterparty?" · "+contract.counterparty:""}</p></div>
      </div>
      <div className="matter-hero-meta">
        <div><span>Cliente</span><strong>{contract.client?.name??"—"}</strong></div>
        <div><span>Responsável</span><strong>{responsible?.name??responsible?.email??"—"}</strong></div>
        <div><span>Status</span>{canEdit?<ContractStatusAction id={contract.id} workspaceId={member.workspaceId} status={contract.status}/>:<strong>{contract.status}</strong>}</div>
      </div>
    </section>

    {(noticeReached||expired)&&<section className="contract-alert"><CalendarClock size={18}/><div><strong>{expired?"Contrato vencido":"Janela de aviso prévio iniciada"}</strong><span>{expired?"A vigência terminou em "+fmt(contract.expiresAt):"A data calculada para aviso é "+fmt(noticeDate)+". Revise renovação, denúncia ou renegociação."}</span></div></section>}

    <section className="metric-grid three">
      <article className="metric-card"><div className="metric-icon"><CalendarClock size={19}/></div><span>Vigência</span><strong className="metric-long">{fmt(contract.expiresAt)}</strong><small>início {fmt(contract.effectiveAt)}</small></article>
      <article className="metric-card"><div className="metric-icon"><ShieldCheck size={19}/></div><span>Aviso prévio</span><strong>{contract.noticeDays??"—"}</strong><small>{contract.noticeDays!=null?"dias":"não informado"}</small></article>
      <article className="metric-card"><div className="metric-icon"><Landmark size={19}/></div><span>Valor</span><strong className="metric-long">{money(contract.amount,contract.currency)}</strong><small>{contract.autoRenew?"renovação automática prevista":"sem renovação automática marcada"}</small></article>
    </section>

    <section className="contract-layout">
      <article className="panel panel-wide">
        <div className="panel-heading"><div><span className="eyebrow">Histórico</span><h2>Linha do tempo do contrato</h2></div></div>
        {history.length===0?<div className="mini-empty">Nenhum evento registrado além do cadastro atual.</div>:<div className="timeline-list">{history.map(h=><div className="timeline-row" key={h.id}><div className="timeline-icon"><ScrollText size={16}/></div><div className="timeline-copy"><strong>{h.summary}</strong><span>{h.type}</span></div><time>{h.occurredAt.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}</time></div>)}</div>}
      </article>

      <aside className="matter-side">
        <article className="panel"><div className="panel-heading"><div><span className="eyebrow">Vínculos</span><h2>Contexto jurídico</h2></div></div>
          <div className="simple-list compact-links">
            {contract.client?<Link href={"/app/clientes/"+contract.client.id}><span className="table-icon"><UserRound size={15}/></span><div><strong>{contract.client.name}</strong><small>Cliente</small></div><span>›</span></Link>:<div><span className="table-icon"><UserRound size={15}/></span><div><strong>Sem cliente</strong><small>Vínculo opcional</small></div></div>}
            {contract.matter?<Link href={"/app/processos/"+contract.matter.id}><span className="table-icon"><BriefcaseBusiness size={15}/></span><div><strong>{contract.matter.number??contract.matter.title}</strong><small>{contract.matter.title}</small></div><span>›</span></Link>:<div><span className="table-icon"><BriefcaseBusiness size={15}/></span><div><strong>Sem processo</strong><small>Contrato autônomo</small></div></div>}
            {contract.document?<Link href={"/app/documentos/"+contract.document.id}><span className="table-icon"><FileText size={15}/></span><div><strong>{contract.document.name}</strong><small>Documento · versão {contract.document.currentVersion}</small></div><span>›</span></Link>:<div><span className="table-icon"><FileText size={15}/></span><div><strong>Sem arquivo vinculado</strong><small>Storage seguro será conectado depois</small></div></div>}
          </div>
        </article>
      </aside>
    </section>
  </div>;
}
