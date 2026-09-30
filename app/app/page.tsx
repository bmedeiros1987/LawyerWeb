import { contractScope, deadlineScope, documentScope, inboxScope, matterScope, taskScope } from "@/lib/authz/visibility";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, BriefcaseBusiness, CalendarClock, CheckCircle2, Clock3, FileText, Gavel, Sparkles } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getActiveMembership } from "@/lib/workspace/context";

export const dynamic="force-dynamic";

function timeLabel(date:Date){
  return date.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
}

export default async function Dashboard(){
  const session=await auth();
  if(!session?.user?.id) redirect("/login");
  const membership=await getActiveMembership(session.user.id);
  if(!membership) redirect("/app/setup");

  const now=new Date();
  const dayStart=new Date(now); dayStart.setHours(0,0,0,0);
  const dayEnd=new Date(dayStart); dayEnd.setDate(dayEnd.getDate()+1);
  const in60d=new Date(now.getTime()+60*24*60*60*1000);
  const myTaskScope={OR:[{assigneeUserId:session.user.id},{requesterUserId:session.user.id},{assigneeUserId:null}]};

  const [deadlines,communications,tasks,contracts,todayDeadlines,todayTasks,todayEvents,recentDocuments,recentMatters]=await Promise.all([
    prisma.deadline.findMany({where:{...deadlineScope(membership),status:{in:["CONFIRMED","IN_PROGRESS"]},risk:{in:["CRITICAL","HIGH"]}},include:{matter:{select:{id:true,number:true,title:true}}},orderBy:[{risk:"desc"},{dueAt:"asc"}],take:3}),
    prisma.courtCommunication.findMany({where:{...inboxScope(membership),status:"NEW"},include:{matter:{select:{id:true,number:true,title:true}}},orderBy:{receivedAt:"desc"},take:3}),
    prisma.legalTask.findMany({where:{...taskScope(membership),status:{notIn:["DONE","CANCELLED"]},AND:[myTaskScope],dueAt:{not:null}},include:{matter:{select:{id:true,number:true,title:true}}},orderBy:{dueAt:"asc"},take:3}),
    prisma.contract.findMany({where:{...contractScope(membership),status:{in:["ACTIVE","EXPIRING","REVIEW","SIGNING"]},expiresAt:{gte:now,lte:in60d}},include:{client:{select:{name:true}}},orderBy:{expiresAt:"asc"},take:3}),
    prisma.deadline.findMany({where:{...deadlineScope(membership),status:{in:["CONFIRMED","IN_PROGRESS"]},dueAt:{gte:dayStart,lt:dayEnd}},include:{matter:{select:{id:true,number:true,title:true}}},orderBy:{dueAt:"asc"},take:6}),
    prisma.legalTask.findMany({where:{...taskScope(membership),status:{notIn:["DONE","CANCELLED"]},AND:[myTaskScope],dueAt:{gte:dayStart,lt:dayEnd}},include:{matter:{select:{id:true,number:true,title:true}}},orderBy:{dueAt:"asc"},take:6}),
    prisma.legalCalendarEvent.findMany({where:{userId:session.user.id,status:{not:"CANCELLED"},OR:[{startAt:{gte:dayStart,lt:dayEnd}},{startDate:dayStart.toISOString().slice(0,10)}]},orderBy:[{startAt:"asc"},{startDate:"asc"}],take:6}),
    prisma.legalDocument.findMany({where:{...documentScope(membership)},include:{client:{select:{name:true}},matter:{select:{id:true,number:true,title:true}}},orderBy:{updatedAt:"desc"},take:4}),
    prisma.matter.findMany({where:{...matterScope(membership)},include:{client:{select:{name:true}}},orderBy:{updatedAt:"desc"},take:4}),
  ]);

  const pulse=[
    ...deadlines.map(d=>({rank:d.risk==="CRITICAL"?0:1,at:d.dueAt??d.createdAt,title:d.title,detail:(d.matter?.number??d.matter?.title??"Prazo confirmado"),tone:"danger",label:d.risk==="CRITICAL"?"Crítico":"Alto",href:"/app/prazos",icon:"deadline"})),
    ...communications.map(c=>({rank:2,at:c.receivedAt,title:c.title??"Nova comunicação",detail:c.source+(c.matter?" · "+(c.matter.number??c.matter.title):""),tone:"",label:"Triar",href:"/app/inbox",icon:"communication"})),
    ...tasks.map(t=>({rank:t.dueAt&&t.dueAt<now?1:3,at:t.dueAt??t.createdAt,title:t.title,detail:t.matter?.number??t.matter?.title??"Tarefa",tone:t.dueAt&&t.dueAt<now?"danger":"quiet",label:t.dueAt&&t.dueAt<now?"Vencida":"Tarefa",href:"/app/tarefas",icon:"task"})),
    ...contracts.map(c=>({rank:4,at:c.expiresAt??c.updatedAt,title:c.title,detail:(c.client?.name??c.counterparty??"Contrato")+(c.expiresAt?" · vence "+c.expiresAt.toLocaleDateString("pt-BR"):""),tone:"quiet",label:"Contrato",href:"/app/contratos",icon:"contract"})),
  ].sort((a,b)=>a.rank-b.rank||a.at.getTime()-b.at.getTime()).slice(0,3);

  const today=[
    ...todayDeadlines.map(d=>({at:d.dueAt!,title:d.title,detail:d.matter?.number??d.matter?.title??"Prazo",href:"/app/prazos",kind:"Prazo"})),
    ...todayTasks.map(t=>({at:t.dueAt!,title:t.title,detail:t.matter?.number??t.matter?.title??"Tarefa",href:"/app/tarefas",kind:"Tarefa"})),
    ...todayEvents.filter(e=>e.startAt).map(e=>({at:e.startAt!,title:e.title,detail:e.location??e.kind,href:"/app/agenda",kind:e.kind==="HEARING"?"Audiência":"Agenda"})),
  ].sort((a,b)=>a.at.getTime()-b.at.getTime()).slice(0,6);

  const changes=[
    ...communications.map(c=>({at:c.receivedAt,title:c.title??"Nova comunicação",detail:c.source,href:"/app/inbox",icon:"communication"})),
    ...recentDocuments.map(d=>({at:d.updatedAt,title:d.name,detail:(d.client?.name??d.matter?.number??d.matter?.title??"Documento")+" · "+d.status,href:"/app/documentos/"+d.id,icon:"document"})),
  ].sort((a,b)=>b.at.getTime()-a.at.getTime()).slice(0,5);

  return <div className="page-stack home-minimal">
    <section className="welcome-row home-welcome"><div><span className="eyebrow">Hoje</span><h1>O que precisa da sua atenção.</h1><p>Sem painel de vaidade. Só o que muda sua próxima ação.</p></div><Link href="/app/inteligencia" className="ask-mblz"><Sparkles size={17}/>Perguntar ao MBLZ</Link></section>

    <section className="home-pulse">
      <div className="home-section-head"><div><span className="eyebrow">MBLZ Pulse</span><h2>Prioridades agora</h2></div><Link href="/app/inbox">Ver Caixa Jurídica <ArrowUpRight size={14}/></Link></div>
      {pulse.length===0?<div className="home-calm"><CheckCircle2 size={18}/><div><strong>Nenhuma exceção importante.</strong><span>O Pulse fica silencioso quando não há nada que exija decisão.</span></div></div>:<div className="home-pulse-grid">{pulse.map((item,index)=>{
        const Icon=item.icon==="deadline"?Clock3:item.icon==="communication"?Gavel:item.icon==="contract"?FileText:CheckCircle2;
        return <Link href={item.href} className={"home-pulse-item "+(item.tone==="danger"?"critical":"")} key={item.icon+index}><span className="home-pulse-icon"><Icon size={17}/></span><div><strong>{item.title}</strong><span>{item.detail}</span></div><b className={"status-pill "+item.tone}>{item.label}</b></Link>
      })}</div>}
    </section>

    <section className="home-two-column">
      <article className="panel home-today">
        <div className="home-section-head"><div><span className="eyebrow">Hoje</span><h2>Sua linha do dia</h2></div><Link href="/app/agenda">Agenda <ArrowUpRight size={14}/></Link></div>
        {today.length===0?<div className="mini-empty">Nenhum prazo, tarefa ou compromisso com horário hoje.</div>:<div className="home-timeline">{today.map((item,index)=><Link href={item.href} key={item.kind+index}><time>{timeLabel(item.at)}</time><span className="home-time-dot"/><div><strong>{item.title}</strong><span>{item.kind} · {item.detail}</span></div></Link>)}</div>}
      </article>

      <article className="panel home-changes">
        <div className="home-section-head"><div><span className="eyebrow">O que mudou</span><h2>Atualizações recentes</h2></div></div>
        {changes.length===0?<div className="mini-empty">Nada novo desde sua última atividade.</div>:<div className="simple-list">{changes.map((item,index)=>{
          const Icon=item.icon==="communication"?Gavel:FileText;
          return <Link href={item.href} key={item.icon+index}><span className="table-icon"><Icon size={15}/></span><div><strong>{item.title}</strong><small>{item.detail}</small></div><span>{item.at.toLocaleDateString("pt-BR")}</span></Link>
        })}</div>}
      </article>
    </section>

    <section className="panel home-recent">
      <div className="home-section-head"><div><span className="eyebrow">Contexto recente</span><h2>Processos que você abriu por último</h2></div><Link href="/app/processos">Todos <ArrowUpRight size={14}/></Link></div>
      {recentMatters.length===0?<div className="mini-empty">Nenhum processo cadastrado ainda.</div>:<div className="home-matter-list">{recentMatters.map(m=><Link href={"/app/processos/"+m.id} key={m.id}><span className="table-icon"><BriefcaseBusiness size={15}/></span><div><strong>{m.number??m.internalCode??m.title}</strong><small>{m.client?.name??m.title}{m.phase?" · "+m.phase:""}</small></div><ArrowUpRight size={14}/></Link>)}</div>}
    </section>
  </div>;
}
