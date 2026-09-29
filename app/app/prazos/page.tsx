import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Clock3, LockKeyhole, ShieldAlert, UserRoundCheck } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";
import { DeadlineConfirm } from "@/components/deadline-confirm";

export const dynamic="force-dynamic";

function riskLabel(risk:string){return risk==="CRITICAL"?"Crítico":risk==="HIGH"?"Alto":risk==="ATTENTION"?"Atenção":"Em dia"}
function statusLabel(status:string){return status==="CANDIDATE"?"Candidato":status==="PENDING_CONFIRMATION"?"Confirmar":status==="CONFIRMED"?"Confirmado":status==="IN_PROGRESS"?"Em andamento":status==="COMPLETED"?"Concluído":"Cancelado"}

export default async function Page() {
  const session=await auth(); if(!session?.user?.id) redirect("/login");
  const member=await getActiveMembership(session.user.id); if(!member) redirect("/app/setup");
  if(!(await memberWithPermission(session.user.id,member.workspaceId,P.DEADLINES_VIEW))) {
    return <div className="empty-state"><LockKeyhole size={28}/><h2>Acesso restrito</h2><p>Seu perfil não possui permissão para consultar prazos.</p></div>;
  }
  const canConfirm=Boolean(await memberWithPermission(session.user.id,member.workspaceId,P.DEADLINES_CONFIRM));
  const now=new Date(); const week=new Date(now.getTime()+7*24*60*60*1000);
  const visibility={OR:[{matterId:null},{matter:{secrecy:false}},{matter:{access:{some:{memberId:member.id}}}}]};

  const [deadlines,members]=await Promise.all([
    prisma.deadline.findMany({
      where:{workspaceId:member.workspaceId,AND:[visibility],status:{notIn:["CANCELLED"]}},
      include:{matter:{select:{id:true,number:true,title:true}}},
      orderBy:[{dueAt:"asc"},{createdAt:"desc"}],
      take:300,
    }),
    prisma.workspaceMember.findMany({where:{workspaceId:member.workspaceId,status:"ACTIVE"},include:{user:{select:{name:true,email:true}}},orderBy:{createdAt:"asc"}}),
  ]);
  const users=members.map(m=>({userId:m.userId,name:m.user.name??m.user.email??"Usuário"}));
  const userIds=[...new Set(deadlines.flatMap(d=>[d.primaryResponsibleUserId,d.reviewerUserId]).filter((x):x is string=>Boolean(x)))];
  const userRows=userIds.length?await prisma.user.findMany({where:{id:{in:userIds}},select:{id:true,name:true,email:true}}):[];
  const names=new Map(userRows.map(u=>[u.id,u.name??u.email??"Usuário"]));
  const critical=deadlines.filter(d=>["CONFIRMED","IN_PROGRESS"].includes(d.status)&&["CRITICAL","HIGH"].includes(d.risk)).length;
  const candidates=deadlines.filter(d=>["CANDIDATE","PENDING_CONFIRMATION"].includes(d.status)).length;
  const nextWeek=deadlines.filter(d=>["CONFIRMED","IN_PROGRESS"].includes(d.status)&&d.dueAt&&d.dueAt>=now&&d.dueAt<=week).length;

  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">Deadline Safety</span><h1>Prazos</h1><p>Prazo legal, prazo interno, responsável, revisor e escalonamento no mesmo lugar.</p></div></section>
    <section className="metric-grid three">
      <article className={"metric-card "+(critical?"priority":"")}><div className="metric-icon"><ShieldAlert size={19}/></div><span>Alto risco</span><strong>{critical}</strong><small>{critical?"exigem acompanhamento":"nenhum agora"}</small></article>
      <article className="metric-card"><div className="metric-icon"><Clock3 size={19}/></div><span>Sem confirmação</span><strong>{candidates}</strong><small>candidatos detectados</small></article>
      <article className="metric-card"><div className="metric-icon"><CheckCircle2 size={19}/></div><span>Próximos 7 dias</span><strong>{nextWeek}</strong><small>confirmados e atribuídos</small></article>
    </section>

    {deadlines.length===0?<div className="empty-state"><Clock3 size={28}/><h2>Nenhum prazo registrado</h2><p>Quando uma comunicação, e-mail ou usuário gerar um prazo candidato, ele aparecerá aqui para revisão humana.</p></div>:
    <section className="table-card">
      <div className="table-head deadlines"><span>Prazo</span><span>Responsável</span><span>Controle</span><span>Risco</span><span>Ação</span></div>
      {deadlines.map(d=>{
        const candidate=["CANDIDATE","PENDING_CONFIRMATION"].includes(d.status);
        const late=Boolean(d.dueAt&&d.dueAt<now&&!["COMPLETED"].includes(d.status));
        return <div className="table-row deadlines" key={d.id}>
          <div className="matter-name"><span className="table-icon"><Clock3 size={16}/></span><div><strong>{d.title}</strong><small>{d.matter?<Link href={"/app/processos/"+d.matter.id}>{d.matter.number??d.matter.title}</Link>:(d.source??"Sem processo")}{d.dueAt?" · legal "+d.dueAt.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}):""}</small></div></div>
          <span>{d.primaryResponsibleUserId?names.get(d.primaryResponsibleUserId)??"Usuário":"Não definido"}</span>
          <span className="deadline-control-copy"><UserRoundCheck size={14}/>{d.reviewerUserId?"Revisor: "+(names.get(d.reviewerUserId)??"Usuário"):candidate?"Revisor obrigatório":"Sem revisor"}</span>
          <span className={"status-pill "+(late||d.risk==="CRITICAL"||d.risk==="HIGH"?"danger":d.risk==="NORMAL"?"success":"")}>{late?"Vencido":candidate?statusLabel(d.status):riskLabel(d.risk)}</span>
          <span>{candidate&&canConfirm?<DeadlineConfirm id={d.id} workspaceId={member.workspaceId} members={users} currentUserId={session.user.id}/>:<span className="table-muted">{statusLabel(d.status)}</span>}</span>
        </div>
      })}
    </section>}
  </div>;
}
