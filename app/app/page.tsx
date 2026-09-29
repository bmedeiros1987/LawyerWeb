import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, CalendarClock, CheckCircle2, CircleAlert, Clock3, FileText, Gavel, Sparkles } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getActiveMembership } from "@/lib/workspace/context";

export const dynamic="force-dynamic";

export default async function Dashboard(){
  const session=await auth();
  if(!session?.user?.id) redirect("/login");
  const membership=await getActiveMembership(session.user.id);
  if(!membership) redirect("/app/setup");

  const now=new Date();
  const in60d=new Date(now.getTime()+60*24*60*60*1000);

  const matterVisible={OR:[{matterId:null},{matter:{secrecy:false}},{matter:{access:{some:{memberId:membership.id}}}}]} as const;
  const taskVisible={OR:[{private:false},{requesterUserId:session.user.id},{assigneeUserId:session.user.id},{reviewerUserId:session.user.id}]} as const;
  const myTaskScope={OR:[{assigneeUserId:session.user.id},{requesterUserId:session.user.id},{assigneeUserId:null}]} as const;

  const [criticalDeadlines,newCommunications,openTasks,expiringContracts,deadlines,communications,tasks,contracts]=await Promise.all([
    prisma.deadline.count({where:{workspaceId:membership.workspaceId,status:{in:["CONFIRMED","IN_PROGRESS"]},risk:{in:["CRITICAL","HIGH"]},AND:[matterVisible]}}),
    prisma.courtCommunication.count({where:{workspaceId:membership.workspaceId,status:"NEW",AND:[matterVisible]}}),
    prisma.legalTask.count({where:{workspaceId:membership.workspaceId,status:{notIn:["DONE","CANCELLED"]},AND:[matterVisible,taskVisible,myTaskScope]}}),
    prisma.contract.count({where:{workspaceId:membership.workspaceId,status:{in:["ACTIVE","EXPIRING","REVIEW","SIGNING"]},expiresAt:{gte:now,lte:in60d},AND:[matterVisible]}}),
    prisma.deadline.findMany({where:{workspaceId:membership.workspaceId,status:{in:["CONFIRMED","IN_PROGRESS"]},AND:[matterVisible]},include:{matter:{select:{id:true,number:true,title:true}}},orderBy:[{risk:"desc"},{dueAt:"asc"}],take:4}),
    prisma.courtCommunication.findMany({where:{workspaceId:membership.workspaceId,status:"NEW",AND:[matterVisible]},include:{matter:{select:{id:true,number:true,title:true}}},orderBy:{receivedAt:"desc"},take:4}),
    prisma.legalTask.findMany({where:{workspaceId:membership.workspaceId,status:{notIn:["DONE","CANCELLED"]},AND:[matterVisible,taskVisible,myTaskScope]},include:{matter:{select:{id:true,number:true,title:true}}},orderBy:[{dueAt:"asc"},{createdAt:"desc"}],take:4}),
    prisma.contract.findMany({where:{workspaceId:membership.workspaceId,status:{in:["REVIEW","SIGNING","EXPIRING"]},AND:[matterVisible]},include:{client:{select:{name:true}}},orderBy:[{expiresAt:"asc"},{updatedAt:"desc"}],take:4}),
  ]);

  const pulse=[
    ...deadlines.map(d=>({kind:"deadline",at:d.dueAt??d.createdAt,title:d.title,detail:(d.matter?.number??d.matter?.title??"Sem processo")+(d.dueAt?" · "+d.dueAt.toLocaleDateString("pt-BR"):""),tone:d.risk==="CRITICAL"||d.risk==="HIGH"?"danger":"",label:d.risk==="CRITICAL"?"Crítico":d.risk==="HIGH"?"Alto":"Prazo",href:"/app/prazos"})),
    ...communications.map(c=>({kind:"communication",at:c.receivedAt,title:c.title??"Nova comunicação",detail:c.source+(c.matter?" · "+(c.matter.number??c.matter.title):""),tone:"",label:"Triar",href:"/app/inbox"})),
    ...tasks.map(t=>({kind:"task",at:t.dueAt??t.createdAt,title:t.title,detail:(t.matter?.number??t.matter?.title??"Sem processo")+(t.dueAt?" · "+t.dueAt.toLocaleDateString("pt-BR"):""),tone:t.dueAt&&t.dueAt<now?"danger":"quiet",label:t.dueAt&&t.dueAt<now?"Vencida":"Tarefa",href:"/app/tarefas"})),
    ...contracts.map(c=>({kind:"contract",at:c.expiresAt??c.updatedAt,title:c.title,detail:(c.client?.name??c.counterparty??"Contrato")+(c.expiresAt?" · vence "+c.expiresAt.toLocaleDateString("pt-BR"):""),tone:"quiet",label:c.status==="REVIEW"?"Revisar":c.status==="SIGNING"?"Assinar":"Contrato",href:"/app/contratos"})),
  ].sort((a,b)=>a.at.getTime()-b.at.getTime()).slice(0,6);

  return <div className="page-stack">
    <section className="welcome-row"><div><span className="eyebrow">Hoje</span><h1>O que precisa da sua atenção.</h1><p>O MBLZ coloca exceções e riscos antes do restante.</p></div><Link href="/app/inteligencia" className="ask-mblz"><Sparkles size={17}/>Perguntar ao MBLZ</Link></section>

    <section className="metric-grid">
      <article className={"metric-card "+(criticalDeadlines?"priority":"")}><div className="metric-icon"><CircleAlert size={19}/></div><span>Prazos de alto risco</span><strong>{criticalDeadlines}</strong><small>{criticalDeadlines?"exigem acompanhamento":"nenhum crítico agora"}</small></article>
      <article className="metric-card"><div className="metric-icon"><Gavel size={19}/></div><span>Novas comunicações</span><strong>{newCommunications}</strong><small>aguardando triagem</small></article>
      <article className="metric-card"><div className="metric-icon"><CheckCircle2 size={19}/></div><span>Minha fila</span><strong>{openTasks}</strong><small>tarefas abertas</small></article>
      <article className="metric-card"><div className="metric-icon"><CalendarClock size={19}/></div><span>Contratos próximos</span><strong>{expiringContracts}</strong><small>vencem em até 60 dias</small></article>
    </section>

    <section className="dashboard-grid">
      <article className="panel panel-wide">
        <div className="panel-heading"><div><span className="eyebrow">MBLZ Pulse</span><h2>Prioridades agora</h2></div><Link className="ghost-button" href="/app/inbox">Caixa Jurídica <ArrowUpRight size={15}/></Link></div>
        {pulse.length===0?<div className="mini-empty">Nenhuma exceção importante detectada. O Pulse permanece silencioso quando não há ação necessária.</div>:<div className="pulse-list">{pulse.map((item,index)=>{
          const Icon=item.kind==="deadline"?Clock3:item.kind==="communication"?Gavel:item.kind==="contract"?FileText:CheckCircle2;
          return <Link href={item.href} className={"pulse-row "+(item.tone==="danger"?"critical":"")} key={item.kind+index}>
            <div className="pulse-symbol"><Icon size={18}/></div>
            <div className="pulse-copy"><strong>{item.title}</strong><span>{item.detail}</span></div>
            <span className={"status-pill "+item.tone}>{item.label}</span>
          </Link>
        })}</div>}
      </article>

      <aside className="panel intelligence-card">
        <div className="mblz-ai-orb"><Sparkles size={22}/></div>
        <span className="eyebrow">Intelligence</span>
        <h2>Briefing jurídico, pronto.</h2>
        <p>Resumos, prioridades e próximos passos a partir do contexto autorizado do escritório, com validação humana.</p>
        <Link href="/app/inteligencia" className="primary-link">Abrir Intelligence</Link>
      </aside>
    </section>
  </div>;
}
