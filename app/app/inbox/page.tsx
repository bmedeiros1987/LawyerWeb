import Link from "next/link";
import { redirect } from "next/navigation";
import { BellRing, Clock3, Gavel, LockKeyhole, Mail, Search, Share2, ShieldAlert } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";
import { InboxTriage } from "@/components/inbox-triage";

export const dynamic="force-dynamic";

function sourceLabel(source:string){return source==="GMAIL"?"Gmail":source==="SHARE_TARGET"?"Compartilhado":source}
function statusLabel(status:string){return status==="NEW"?"Novo":status==="READ"?"Lido":status==="TRIAGED"?"Triado":status==="TREATED"?"Tratado":status==="CONFIRMED"?"Confirmado":status==="CONVERTED"?"Convertido":status==="DISMISSED"?"Descartado":"Revisar"}

export default async function Page({searchParams}:{searchParams:Promise<{q?:string}>}) {
  const session=await auth(); if(!session?.user?.id) redirect("/login");
  const member=await getActiveMembership(session.user.id); if(!member) redirect("/app/setup");
  if(!(await memberWithPermission(session.user.id,member.workspaceId,P.MATTERS_VIEW))) {
    return <div className="empty-state"><LockKeyhole size={28}/><h2>Acesso restrito</h2><p>Seu perfil não possui acesso à Caixa Jurídica.</p></div>;
  }
  const canTriage=Boolean(await memberWithPermission(session.user.id,member.workspaceId,P.INBOX_TRIAGE));
  const canCreateTask=Boolean(await memberWithPermission(session.user.id,member.workspaceId,P.TASKS_EDIT));
  const canCreateDeadline=Boolean(await memberWithPermission(session.user.id,member.workspaceId,P.DEADLINES_CREATE));
  const {q=""}=await searchParams; const search=q.trim();
  const visibility={OR:[{matterId:null},{matter:{secrecy:false}},{matter:{access:{some:{memberId:member.id}}}}]};

  const [communications,demands,emailAgentPreference]=await Promise.all([
    prisma.courtCommunication.findMany({
      where:{workspaceId:member.workspaceId,AND:[
        visibility,
        ...(search?[{OR:[
          {title:{contains:search,mode:"insensitive" as const}},
          {body:{contains:search,mode:"insensitive" as const}},
          {source:{contains:search,mode:"insensitive" as const}},
          {matter:{number:{contains:search,mode:"insensitive" as const}}},
          {matter:{title:{contains:search,mode:"insensitive" as const}}},
        ]}]:[]),
      ]},
      include:{matter:{select:{id:true,number:true,title:true}}},
      orderBy:{receivedAt:"desc"},take:150,
    }),
    prisma.intakeDemand.findMany({
      where:{workspaceId:member.workspaceId,AND:[
        visibility,
        ...(search?[{OR:[
          {title:{contains:search,mode:"insensitive" as const}},
          {bodyPreview:{contains:search,mode:"insensitive" as const}},
          {sender:{contains:search,mode:"insensitive" as const}},
          {matter:{number:{contains:search,mode:"insensitive" as const}}},
          {matter:{title:{contains:search,mode:"insensitive" as const}}},
          {client:{name:{contains:search,mode:"insensitive" as const}}},
        ]}]:[]),
      ]},
      include:{matter:{select:{id:true,number:true,title:true}},client:{select:{id:true,name:true}}},
      orderBy:{receivedAt:"desc"},take:150,
    }),
    prisma.agentChannelPreference.findUnique({
      where:{workspaceId_userId_channel:{workspaceId:member.workspaceId,userId:session.user.id,channel:"EMAIL"}},
      select:{enabled:true},
    }),
  ]);

  const rows=[
    ...communications.map(c=>({
      id:"court-"+c.id,sourceId:c.id,sourceType:"COURT" as const,kind:"COURT",source:c.source,title:c.title??"Comunicação processual",
      preview:c.body?.slice(0,180)??null,receivedAt:c.receivedAt,status:c.status,
      requiresAction:c.requiresAction,matter:c.matter,client:null,suggestedDue:null,
    })),
    ...demands.map(d=>({
      id:"demand-"+d.id,sourceId:d.id,sourceType:"DEMAND" as const,kind:d.source,source:sourceLabel(d.source),title:d.title,
      preview:d.actionCandidate??d.bodyPreview?.slice(0,180)??null,receivedAt:d.receivedAt,status:d.status,
      requiresAction:d.requiresAction,matter:d.matter,client:d.client,suggestedDue:d.dueCandidate?d.dueCandidate.toISOString():null,
    })),
  ].sort((a,b)=>b.receivedAt.getTime()-a.receivedAt.getTime()).slice(0,250);

  const actionCount=rows.filter(r=>r.requiresAction&&!["TREATED","CONVERTED","DISMISSED"].includes(r.status)).length;

  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">LawyerMind Push</span><h1>Caixa Jurídica</h1><p>Tribunais, Gmail e compartilhamentos em uma única fila antes de virarem tarefa ou prazo.</p></div></section>
    <form className="toolbar-card" action="/app/inbox" method="get"><div className="search-field"><Search size={17}/><input name="q" defaultValue={search} placeholder="Processo, cliente, remetente, tribunal ou conteúdo"/></div></form>

    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">Entrada única</span><h2>{search?"Resultados":"Novas entradas"}</h2></div>{actionCount>0&&<span className="status-pill danger"><ShieldAlert size={11}/>{actionCount} exigem ação</span>}</div>
      {rows.length===0?<div className="mini-empty">{search?"Nenhuma entrada encontrada.":"A Caixa Jurídica está vazia. Quando Gmail, tribunais ou compartilhamentos enviarem algo, aparecerá aqui."}</div>:
      <div className="inbox-list">{rows.map(row=>{
        const Icon=row.kind==="COURT"?Gavel:row.kind==="GMAIL"?Mail:row.kind==="SHARE_TARGET"?Share2:BellRing;
        const processLabel=row.matter?(row.matter.number??row.matter.title):row.client?.name??"Ainda sem vínculo";
        return <div className={"inbox-row "+(row.requiresAction?"attention":"")} key={row.id}>
          <div className="inbox-icon"><Icon size={18}/></div>
          <div className="inbox-copy">
            <div><strong>{row.title}</strong><span className="source-chip">{row.source}</span></div>
            <span>{processLabel} · {row.receivedAt.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}</span>
            {row.preview&&<p>{row.preview}</p>}
          </div>
          <div className="inbox-state">
            {canTriage?<InboxTriage workspaceId={member.workspaceId} sourceType={row.sourceType} sourceId={row.sourceId} status={row.status} defaultTitle={row.title} suggestedDue={row.suggestedDue} canCreateTask={canCreateTask} canCreateDeadline={canCreateDeadline} canGenerateAgentDraft={Boolean(emailAgentPreference?.enabled)&&row.kind==="GMAIL"}/>:<span className={"status-pill "+(row.requiresAction?"danger":"quiet")}>{row.requiresAction?"Revisar":statusLabel(row.status)}</span>}
            {row.matter&&<Link href={"/app/processos/"+row.matter.id}>Abrir processo</Link>}
          </div>
        </div>
      })}</div>}
    </section>

    <section className="panel inbox-safety-note"><Clock3 size={18}/><div><strong>Entrada não é prazo confirmado.</strong><span>O LawyerMind pode sugerir uma demanda ou data, mas um prazo legal só entra no Deadline Safety após revisão humana.</span></div></section>
  </div>;
}
