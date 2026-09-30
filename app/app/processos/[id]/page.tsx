import { contractScope, deadlineScope, documentScope, inboxScope, taskScope } from "@/lib/authz/visibility";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BellRing, BriefcaseBusiness, CalendarClock, CheckCircle2, Clock3, FileText, Landmark, LockKeyhole, ScrollText } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, canAccessMatter, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";

export const dynamic="force-dynamic";

function when(date:Date){return date.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}
function deadlineTone(risk:string){return risk==="CRITICAL"||risk==="HIGH"?"danger":risk==="ATTENTION"?"":"success"}

export default async function MatterPage({params}:{params:Promise<{id:string}>}) {
  const session=await auth(); if(!session?.user?.id) redirect("/login");
  const member=await getActiveMembership(session.user.id); if(!member) redirect("/app/setup");
  if(!(await memberWithPermission(session.user.id,member.workspaceId,P.MATTERS_VIEW))) notFound();
  const {id}=await params;
  if(!(await canAccessMatter(session.user.id,member.workspaceId,id,P.MATTERS_VIEW))) notFound();

  const matter=await prisma.matter.findFirst({
    where:{id,workspaceId:member.workspaceId},
    include:{
      client:true,
      tasks: { where: taskScope(member), orderBy:[{dueAt:"asc"},{createdAt:"desc"}],take:80},
      deadlines: { where: deadlineScope(member), orderBy:[{dueAt:"asc"},{createdAt:"desc"}],take:80},
      communications: { where: inboxScope(member), orderBy:{receivedAt:"desc"},take:80},
      documents: { where: documentScope(member), orderBy:{updatedAt:"desc"},take:80},
      contracts: { where: contractScope(member), orderBy:{updatedAt:"desc"},take:80},
    },
  });
  if(!matter) notFound();

  const responsible=matter.responsibleUserId?await prisma.user.findUnique({where:{id:matter.responsibleUserId},select:{name:true,email:true}}):null;
  const timeline=[
    ...matter.communications.map(x=>({type:"COMMUNICATION",at:x.receivedAt,title:x.title??"Comunicação processual",detail:x.source,status:x.status,id:x.id})),
    ...matter.deadlines.map(x=>({type:"DEADLINE",at:x.createdAt,title:x.title,detail:x.dueAt?"Prazo: "+when(x.dueAt):"Prazo candidato",status:x.risk,id:x.id})),
    ...matter.tasks.map(x=>({type:"TASK",at:x.createdAt,title:x.title,detail:x.dueAt?"Entrega: "+when(x.dueAt):"Sem prazo",status:x.status,id:x.id})),
    ...matter.documents.map(x=>({type:"DOCUMENT",at:x.updatedAt,title:x.name,detail:"Versão "+x.currentVersion,status:x.status,id:x.id})),
    ...matter.contracts.map(x=>({type:"CONTRACT",at:x.updatedAt,title:x.title,detail:x.counterparty??x.contractType,status:x.status,id:x.id})),
  ].sort((a,b)=>b.at.getTime()-a.at.getTime()).slice(0,120);

  const nextDeadline=matter.deadlines.find(d=>["CONFIRMED","IN_PROGRESS"].includes(d.status)&&d.dueAt);
  const openTasks=matter.tasks.filter(t=>!["DONE","CANCELLED"].includes(t.status));

  return <div className="page-stack">
    <section className="matter-hero">
      <div className="matter-hero-main">
        <div className="matter-kicker">{matter.secrecy&&<LockKeyhole size={14}/>}<span>{matter.number||matter.internalCode||"Assunto interno"}</span></div>
        <h1>{matter.title}</h1>
        <p>{matter.client?<Link href={"/app/clientes/"+matter.client.id}>{matter.client.name}</Link>:"Sem cliente vinculado"}{matter.practiceArea?" · "+matter.practiceArea:""}</p>
      </div>
      <div className="matter-hero-meta">
        <div><span>Responsável</span><strong>{responsible?.name??responsible?.email??"Não definido"}</strong></div>
        <div><span>Fase atual</span><strong>{matter.phase??"Não informada"}</strong></div>
        <div><span>Situação</span><strong>{matter.status}</strong></div>
      </div>
    </section>

    <section className="metric-grid three">
      <article className={"metric-card "+(nextDeadline?.risk==="CRITICAL"?"priority":"")}><div className="metric-icon"><Clock3 size={19}/></div><span>Próximo prazo</span><strong className="metric-long">{nextDeadline?.dueAt?nextDeadline.dueAt.toLocaleDateString("pt-BR"):"—"}</strong><small>{nextDeadline?.title??"nenhum prazo confirmado"}</small></article>
      <article className="metric-card"><div className="metric-icon"><CheckCircle2 size={19}/></div><span>Tarefas abertas</span><strong>{openTasks.length}</strong><small>{matter.tasks.filter(t=>t.status==="REVIEW").length} em revisão</small></article>
      <article className="metric-card"><div className="metric-icon"><BellRing size={19}/></div><span>Comunicações</span><strong>{matter.communications.length}</strong><small>{matter.communications.filter(c=>c.status==="NEW").length} novas</small></article>
    </section>

    <section className="matter-layout">
      <article className="panel panel-wide">
        <div className="panel-heading"><div><span className="eyebrow">Timeline</span><h2>Histórico do assunto</h2></div><span className="status-pill quiet">{timeline.length} eventos</span></div>
        {timeline.length===0?<div className="mini-empty">Ainda não há eventos vinculados.</div>:<div className="timeline-list">{timeline.map(item=>{
          const Icon=item.type==="COMMUNICATION"?BellRing:item.type==="DEADLINE"?Clock3:item.type==="TASK"?CheckCircle2:item.type==="CONTRACT"?ScrollText:FileText;
          return <div className="timeline-row" key={item.type+item.id}><div className="timeline-icon"><Icon size={16}/></div><div className="timeline-copy"><strong>{item.title}</strong><span>{item.detail}</span></div><time>{when(item.at)}</time></div>
        })}</div>}
      </article>

      <aside className="matter-side">
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">Contexto</span><h2>Processo</h2></div></div>
          <dl className="detail-list">
            <div><dt>Tribunal</dt><dd>{matter.court??"—"}</dd></div>
            <div><dt>Órgão / Vara</dt><dd>{matter.courtUnit??"—"}</dd></div>
            <div><dt>Jurisdição</dt><dd>{matter.jurisdiction??"—"}</dd></div>
            <div><dt>Pasta interna</dt><dd>{matter.internalCode??"—"}</dd></div>
          </dl>
        </article>
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">Vínculos</span><h2>Materiais</h2></div></div>
          <div className="matter-links">
            <span><FileText size={15}/><b>{matter.documents.length}</b> documentos</span>
            <span><ScrollText size={15}/><b>{matter.contracts.length}</b> contratos</span>
            <span><CalendarClock size={15}/><b>{matter.deadlines.length}</b> prazos</span>
            <span><Landmark size={15}/><b>—</b> financeiro</span>
          </div>
        </article>
      </aside>
    </section>
  </div>;
}
