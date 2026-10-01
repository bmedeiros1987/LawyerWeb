import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, BriefcaseBusiness, Clock3, FileCheck2, Gauge, LockKeyhole, ScrollText } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, memberWithPermission } from "@/lib/authz/permissions";
import { allows, contractScope, deadlineScope, documentScope, matterScope, taskScope } from "@/lib/authz/visibility";
import { visibleActivities } from "@/lib/reports/worklog";
import { getActiveMembership } from "@/lib/workspace/context";
import { countsAsHighRiskDeadline } from "@/lib/deadlines/presentation";

export const dynamic="force-dynamic";

function actionLabel(type:string){
  const labels:Record<string,string>={
    ADD_PARTY:"Parte vinculada",ADD_PHASE:"Fase registrada",ADD_MOVEMENT:"Andamento registrado",
    WORKSPACE_CREATED:"Workspace criado",CLIENT_CREATED:"Cliente cadastrado",MATTER_CREATED:"Processo/assunto cadastrado",
    TASK_CREATED:"Tarefa criada",TASK_UPDATED:"Tarefa atualizada",TASK_COMPLETED:"Tarefa concluída",
    DEADLINE_CANDIDATE_CREATED:"Prazo candidato criado",DEADLINE_CONFIRMED:"Prazo confirmado",DEADLINE_COMPLETED:"Prazo concluído",
    CONTRACT_CREATED:"Contrato cadastrado",CONTRACT_UPDATED:"Contrato atualizado",DOCUMENT_CREATED:"Documento criado",DOCUMENT_UPDATED:"Documento atualizado",
    GMAIL_CONNECTED:"Gmail conectado",GMAIL_DISCONNECTED:"Gmail desconectado",DEMAND_SHARED_TO_MBLZ:"Demanda compartilhada",
  };
  return labels[type]??type.replaceAll("_"," ").toLowerCase();
}

export default async function Page() {
  const session=await auth(); if(!session?.user?.id)redirect("/login");
  const member=await getActiveMembership(session.user.id); if(!member)redirect("/app/setup");
  if(!(await memberWithPermission(session.user.id,member.workspaceId,P.REPORTS_VIEW))) {
    return <div className="empty-state"><LockKeyhole size={28}/><h2>Acesso restrito</h2><p>Seu perfil não possui permissão para consultar relatórios.</p></div>;
  }

  const now=new Date();
  const since30=new Date(now.getTime()-30*24*60*60*1000);
  const stale90=new Date(now.getTime()-90*24*60*60*1000);
  const in60=new Date(now.getTime()+60*24*60*60*1000);
  const visibleMatters = await prisma.matter.findMany({where:matterScope(member),select:{id:true}});

  const [deadlines,tasks,contracts,staleMatters,rawActivities,timeEntries,documents]=await Promise.all([
    prisma.deadline.findMany({where:{workspaceId:member.workspaceId,status:{notIn:["COMPLETED","CANCELLED"]},AND:[deadlineScope(member)]},select:{id:true,status:true,risk:true,dueAt:true}}),
    prisma.legalTask.findMany({where:{workspaceId:member.workspaceId,status:{notIn:["DONE","CANCELLED"]},AND:[taskScope(member)]},select:{id:true,status:true,dueAt:true}}),
    prisma.contract.findMany({where:{workspaceId:member.workspaceId,status:{notIn:["ARCHIVED","TERMINATED"]},AND:[contractScope(member)]},select:{id:true,status:true,expiresAt:true,title:true,client:{select:{name:true}}},orderBy:{expiresAt:"asc"}}),
    prisma.matter.findMany({where:{workspaceId:member.workspaceId,status:"ACTIVE",updatedAt:{lt:stale90},AND:[matterScope(member)]},select:{id:true,number:true,title:true,updatedAt:true,client:{select:{name:true}}},orderBy:{updatedAt:"asc"},take:40}),
    prisma.activityLog.findMany({where:{workspaceId:member.workspaceId,userId:session.user.id,occurredAt:{gte:since30}},orderBy:{occurredAt:"desc"},take:300}),
    prisma.timeEntry.findMany({where:{workspaceId:member.workspaceId,userId:session.user.id,startedAt:{gte:since30},OR:[{matterId:null},{matterId:{in:visibleMatters.map(m=>m.id)}}]},select:{minutes:true,startedAt:true,billable:true}}),
    prisma.legalDocument.findMany({where:{workspaceId:member.workspaceId,updatedAt:{gte:since30},AND:[documentScope(member)]},select:{status:true,kind:true}}),
  ]);

  const activities=await visibleActivities(member,rawActivities);

  const critical=deadlines.filter(d=>countsAsHighRiskDeadline(d.status,d.risk)).length;
  const candidates=deadlines.filter(d=>["CANDIDATE","PENDING_CONFIRMATION"].includes(d.status)).length;
  const overdue=tasks.filter(t=>t.dueAt&&t.dueAt<now).length;
  const expiring=contracts.filter(c=>c.expiresAt&&c.expiresAt>=now&&c.expiresAt<=in60).length;
  const signed=documents.filter(d=>d.status==="SIGNED").length;
  const inReview=documents.filter(d=>d.status==="IN_REVIEW").length;
  const totalMinutes=timeEntries.reduce((sum,t)=>sum+(t.minutes??0),0);
  const billableMinutes=timeEntries.filter(t=>t.billable).reduce((sum,t)=>sum+(t.minutes??0),0);

  const byDay=new Map<string,typeof activities>();
  for(const activity of activities){
    const key=activity.occurredAt.toLocaleDateString("pt-BR",{timeZone:member.workspace.timezone});
    const list=byDay.get(key)??[]; list.push(activity); byDay.set(key,list);
  }

  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">Gestão</span><h1>Relatórios</h1><p>Métricas que ajudam a agir e um registro automático do trabalho realizado.</p></div></section>

    <section className="metric-grid">
      <article className={"metric-card "+(critical?"priority":"")}><div className="metric-icon"><Clock3 size={19}/></div><span>Prazos alto risco</span><strong>{allows(member,P.DEADLINES_VIEW)?critical:"—"}</strong><small>{candidates} ainda sem confirmação</small></article>
      <article className={"metric-card "+(overdue?"priority":"")}><div className="metric-icon"><Gauge size={19}/></div><span>Tarefas vencidas</span><strong>{allows(member,P.TASKS_VIEW)?overdue:"—"}</strong><small>na sua visibilidade atual</small></article>
      <article className="metric-card"><div className="metric-icon"><ScrollText size={19}/></div><span>Contratos em 60 dias</span><strong>{allows(member,P.CONTRACTS_VIEW)?expiring:"—"}</strong><small>vigências próximas</small></article>
      <article className="metric-card"><div className="metric-icon"><FileCheck2 size={19}/></div><span>Documentos 30 dias</span><strong>{allows(member,P.DOCUMENTS_VIEW)?documents.length:"—"}</strong><small>{inReview} em revisão · {signed} assinados</small></article>
    </section>

    <section className="reports-grid">
      <article className="panel panel-wide">
        <div className="panel-heading"><div><span className="eyebrow">Meu trabalho</span><h2>Atividades acessíveis — últimos 30 dias</h2></div><span className="status-pill quiet">{activities.length} atividades{rawActivities.length===300?" · últimas 300 verificadas":""}</span></div>
        <div className="worklog-summary"><div><strong>{Math.floor(totalMinutes/60)}h {totalMinutes%60}min</strong><span>tempo registrado</span></div><div><strong>{Math.floor(billableMinutes/60)}h {billableMinutes%60}min</strong><span>tempo tarifável</span></div><div><strong>{byDay.size}</strong><span>dias com atividade</span></div></div>
        {activities.length===0?<div className="mini-empty">Ainda não há atividade registrada nos últimos 30 dias.</div>:<div className="worklog-days">{[...byDay.entries()].slice(0,12).map(([day,items])=><section key={day}><time>{day}</time><div>{items.slice(0,12).map(a=><div className="worklog-row" key={a.id}><span><Activity size={14}/></span><div><strong>{a.summary}</strong><small>{actionLabel(a.type)} · {a.occurredAt.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",timeZone:member.workspace.timezone})}</small></div></div>)}</div></section>)}</div>}
      </article>

      <aside className="matter-side">
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">Higiene operacional</span><h2>Assuntos sem atualização</h2></div><span className="status-pill quiet">90+ dias</span></div>
          {staleMatters.length===0?<div className="mini-empty">Nenhum assunto ativo está há mais de 90 dias sem atualização interna.</div>:<div className="simple-list">{staleMatters.slice(0,10).map(m=><Link href={"/app/processos/"+m.id} key={m.id}><span className="table-icon"><BriefcaseBusiness size={15}/></span><div><strong>{m.number??m.title}</strong><small>{m.client?.name??m.title} · atualizado {m.updatedAt.toLocaleDateString("pt-BR")}</small></div><span>›</span></Link>)}</div>}
          <p className="report-caveat">Este indicador usa a última atualização do registro no MBLZ. Ele só será chamado de “sem movimentação processual” quando o módulo de andamentos judiciais estiver alimentando uma data oficial de movimentação.</p>
        </article>
      </aside>
    </section>
  </div>;
}
