import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowUpRight, BriefcaseBusiness, Building2, FileText, Mail, Phone, ScrollText, UserRound } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";

export const dynamic="force-dynamic";

export default async function ClientPage({params}:{params:Promise<{id:string}>}) {
  const session=await auth(); if(!session?.user?.id) redirect("/login");
  const member=await getActiveMembership(session.user.id); if(!member) redirect("/app/setup");
  if(!(await memberWithPermission(session.user.id,member.workspaceId,P.CLIENTS_VIEW))) notFound();
  const {id}=await params;
  const client=await prisma.client.findFirst({
    where:{id,workspaceId:member.workspaceId},
    include:{
      matters:{where:{OR:[{secrecy:false},{access:{some:{memberId:member.id}}}]},orderBy:{updatedAt:"desc"},take:100},
      documents:{where:{OR:[{matterId:null},{matter:{secrecy:false}},{matter:{access:{some:{memberId:member.id}}}}]},orderBy:{updatedAt:"desc"},take:50},
      contracts:{where:{OR:[{matterId:null},{matter:{secrecy:false}},{matter:{access:{some:{memberId:member.id}}}}]},orderBy:{updatedAt:"desc"},take:50},
      intakeDemands:{where:{OR:[{matterId:null},{matter:{secrecy:false}},{matter:{access:{some:{memberId:member.id}}}}]},orderBy:{receivedAt:"desc"},take:50},
    },
  });
  if(!client) notFound();

  return <div className="page-stack">
    <section className="matter-hero client-hero">
      <div className="matter-hero-main">
        <div className="client-big-icon">{client.type==="INDIVIDUAL"?<UserRound size={26}/>:<Building2 size={26}/>}</div>
        <div><span className="eyebrow">Cliente</span><h1>{client.name}</h1><p>{client.legalName??(client.type==="INDIVIDUAL"?"Pessoa física":"Pessoa jurídica")}</p></div>
      </div>
      <div className="matter-hero-meta">
        <div><span>CPF/CNPJ</span><strong>{client.cpfCnpj??"—"}</strong></div>
        <div><span>Status</span><strong>{client.status}</strong></div>
      </div>
    </section>

    <section className="client-detail-grid">
      <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Relacionamento</span><h2>Contato</h2></div></div>
        <div className="contact-lines">
          <span><Mail size={15}/>{client.email??"E-mail não informado"}</span>
          <span><Phone size={15}/>{client.phone??"Telefone não informado"}</span>
        </div>
        {client.notes&&<p className="client-notes">{client.notes}</p>}
      </article>
      <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Resumo</span><h2>Visão 360º</h2></div></div>
        <div className="client-summary-grid">
          <div><strong>{client.matters.length}</strong><span>processos</span></div>
          <div><strong>{client.contracts.length}</strong><span>contratos</span></div>
          <div><strong>{client.documents.length}</strong><span>documentos</span></div>
          <div><strong>{client.intakeDemands.length}</strong><span>demandas</span></div>
        </div>
      </article>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">Assuntos</span><h2>Processos e trabalhos jurídicos</h2></div></div>
      {client.matters.length===0?<div className="mini-empty">Nenhum processo vinculado.</div>:<div className="simple-list">{client.matters.map(m=><Link href={"/app/processos/"+m.id} key={m.id}><span className="table-icon"><BriefcaseBusiness size={15}/></span><div><strong>{m.number||m.internalCode||m.title}</strong><small>{m.title}{m.practiceArea?" · "+m.practiceArea:""}</small></div><ArrowUpRight size={15}/></Link>)}</div>}
    </section>

    <section className="client-detail-grid">
      <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Contratos</span><h2>Documentos legais</h2></div></div>
        {client.contracts.length===0?<div className="mini-empty">Nenhum contrato vinculado.</div>:<div className="simple-list">{client.contracts.slice(0,8).map(c=><div key={c.id}><span className="table-icon"><ScrollText size={15}/></span><div><strong>{c.title}</strong><small>{c.status}{c.expiresAt?" · vence "+c.expiresAt.toLocaleDateString("pt-BR"):""}</small></div></div>)}</div>}
      </article>
      <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Arquivos</span><h2>Documentos recentes</h2></div></div>
        {client.documents.length===0?<div className="mini-empty">Nenhum documento vinculado.</div>:<div className="simple-list">{client.documents.slice(0,8).map(d=><div key={d.id}><span className="table-icon"><FileText size={15}/></span><div><strong>{d.name}</strong><small>{d.kind} · versão {d.currentVersion}</small></div></div>)}</div>}
      </article>
    </section>
  </div>;
}
