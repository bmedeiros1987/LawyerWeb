import { matterScope, taskScope } from "@/lib/authz/visibility";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, CircleDot, Clock3, LockKeyhole, UserRoundCheck } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";
import { QuickTaskForm } from "@/components/legal-quick-create";
import { TaskActions } from "@/components/task-actions";

export const dynamic="force-dynamic";

function label(status:string){return status==="DONE"?"Concluída":status==="IN_PROGRESS"?"Em andamento":status==="WAITING"?"Aguardando":status==="REVIEW"?"Revisão":status==="CANCELLED"?"Cancelada":"Aberta"}

export default async function Page({searchParams}:{searchParams:Promise<{scope?:string}>}) {
  const session=await auth(); if(!session?.user?.id) redirect("/login");
  const member=await getActiveMembership(session.user.id); if(!member) redirect("/app/setup");
  if(!(await memberWithPermission(session.user.id,member.workspaceId,P.TASKS_VIEW))) {
    return <div className="empty-state"><LockKeyhole size={28}/><h2>Acesso restrito</h2><p>Seu perfil não possui permissão para consultar tarefas.</p></div>;
  }
  const canEdit=Boolean(await memberWithPermission(session.user.id,member.workspaceId,P.TASKS_EDIT));
  const {scope="mine"}=await searchParams;
  const scopeFilter=scope==="requested"?{requesterUserId:session.user.id}:scope==="assigned"?{assigneeUserId:session.user.id}:scope==="unassigned"?{assigneeUserId:null}:scope==="all"?{}:{OR:[{requesterUserId:session.user.id},{assigneeUserId:session.user.id},{assigneeUserId:null}]};
  const [tasks,matters,members]=await Promise.all([
    prisma.legalTask.findMany({
      where:{workspaceId:member.workspaceId,AND:[
        taskScope(member),
        scopeFilter,
        {status:{notIn:["DONE","CANCELLED"]}},
      ]},
      include:{matter:{select:{id:true,number:true,title:true}}},
      orderBy:[{dueAt:"asc"},{createdAt:"desc"}],take:250,
    }),
    prisma.matter.findMany({where:matterScope(member),select:{id:true,number:true,title:true},orderBy:{updatedAt:"desc"},take:300}),
    prisma.workspaceMember.findMany({where:{workspaceId:member.workspaceId,status:"ACTIVE"},include:{user:{select:{name:true,email:true}}},orderBy:{createdAt:"asc"}}),
  ]);
  const now=new Date(); const overdue=tasks.filter(t=>t.dueAt&&t.dueAt<now).length; const review=tasks.filter(t=>t.status==="REVIEW").length;

  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">Fila de trabalho</span><h1>Tarefas</h1><p>Solicitante, encarregado, revisão e prazo interno sem perder o vínculo com o processo.</p></div>
      {canEdit&&<QuickTaskForm workspaceId={member.workspaceId} matters={matters.map(m=>({id:m.id,label:[m.number,m.title].filter(Boolean).join(" · ")}))} members={members.map(m=>({userId:m.userId,name:m.user.name??m.user.email??"Usuário"}))}/>}
    </section>
    <section className="metric-grid three">
      <article className="metric-card priority"><div className="metric-icon"><Clock3 size={19}/></div><span>Vencidas</span><strong>{overdue}</strong><small>precisam de ação</small></article>
      <article className="metric-card"><div className="metric-icon"><UserRoundCheck size={19}/></div><span>Em revisão</span><strong>{review}</strong><small>aguardando segunda checagem</small></article>
      <article className="metric-card"><div className="metric-icon"><CheckCircle2 size={19}/></div><span>Pendentes</span><strong>{tasks.length}</strong><small>na visão atual</small></article>
    </section>
    <div className="scope-tabs">{[["mine","Minha fila"],["assigned","Sou encarregado"],["requested","Solicitei"],["unassigned","Sem encarregado"],["all","Todas"]].map(([key,text])=><Link key={key} href={"/app/tarefas?scope="+key} className={scope===key?"active":""}>{text}</Link>)}</div>
    {tasks.length===0?<div className="empty-state"><CheckCircle2 size={28}/><h2>Nenhuma tarefa pendente</h2><p>Esta visão está limpa.</p></div>:
    <section className="table-card"><div className="table-head tasks"><span>Tarefa</span><span>Processo</span><span>Prazo</span><span>Status</span><span/></div>{tasks.map(t=>{
      const late=Boolean(t.dueAt&&t.dueAt<now);
      return <div className="table-row tasks" key={t.id}>
        <div className="matter-name"><span className="table-icon"><CircleDot size={15}/></span><div><strong>{t.title}</strong><small>{t.priority+(t.private?" · privada":"")}</small></div></div>
        <span>{t.matter?[t.matter.number,t.matter.title].filter(Boolean).join(" · "):"Sem processo"}</span>
        <span className={late?"text-danger":""}>{t.dueAt?t.dueAt.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}):"Sem prazo"}</span>
        <span className={"status-pill "+(late?"danger":t.status==="REVIEW"?"":"quiet")}>{label(t.status)}</span>{canEdit?<TaskActions id={t.id} workspaceId={member.workspaceId} status={t.status}/>:<span/>}
      </div>
    })}</section>}
  </div>;
}
