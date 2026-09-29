import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, BriefcaseBusiness, CircleDot, Filter, LockKeyhole, Search } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";
import { QuickMatterForm } from "@/components/legal-quick-create";

export const dynamic = "force-dynamic";

export default async function Page({searchParams}:{searchParams:Promise<{q?:string}>}) {
  const session=await auth(); if(!session?.user?.id) redirect("/login");
  const member=await getActiveMembership(session.user.id); if(!member) redirect("/app/setup");
  if(!(await memberWithPermission(session.user.id,member.workspaceId,P.MATTERS_VIEW))) {
    return <div className="empty-state"><LockKeyhole size={28}/><h2>Acesso restrito</h2><p>Seu perfil não possui permissão para consultar processos.</p></div>;
  }
  const {q=""}=await searchParams; const search=q.trim();
  const [matters,clients,members]=await Promise.all([
    prisma.matter.findMany({
      where:{workspaceId:member.workspaceId,AND:[
        {OR:[{secrecy:false},{access:{some:{memberId:member.id}}}]},
        ...(search?[{OR:[
          {number:{contains:search,mode:"insensitive" as const}},
          {internalCode:{contains:search,mode:"insensitive" as const}},
          {title:{contains:search,mode:"insensitive" as const}},
          {client:{name:{contains:search,mode:"insensitive" as const}}},
        ]}]:[]),
      ]},
      include:{
        client:{select:{id:true,name:true}},
        communications:{select:{receivedAt:true,title:true,source:true},orderBy:{receivedAt:"desc"},take:1},
        deadlines:{select:{dueAt:true,risk:true,status:true,title:true},where:{status:{in:["CONFIRMED","IN_PROGRESS"]}},orderBy:{dueAt:"asc"},take:1},
        _count:{select:{tasks:true,deadlines:true,documents:true,communications:true}},
      },
      orderBy:{updatedAt:"desc"},take:200,
    }),
    prisma.client.findMany({where:{workspaceId:member.workspaceId,status:"ACTIVE"},select:{id:true,name:true},orderBy:{name:"asc"},take:300}),
    prisma.workspaceMember.findMany({where:{workspaceId:member.workspaceId,status:"ACTIVE"},include:{user:{select:{id:true,name:true,email:true}}},orderBy:{createdAt:"asc"}}),
  ]);

  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">Contencioso & assuntos</span><h1>Processos</h1><p>O prontuário jurídico centraliza movimentações, tarefas, prazos, documentos e comunicações.</p></div>
      <QuickMatterForm workspaceId={member.workspaceId} clients={clients} members={members.map(m=>({userId:m.userId,name:m.user.name??m.user.email??"Usuário"}))}/>
    </section>

    <form className="toolbar-card" action="/app/processos" method="get">
      <div className="search-field"><Search size={17}/><input name="q" defaultValue={search} placeholder="Número CNJ, pasta, cliente ou assunto"/></div>
      <button className="filter-button" type="submit"><Filter size={16}/>Buscar</button>
    </form>

    {matters.length===0 ? <div className="empty-state"><BriefcaseBusiness size={28}/><h2>{search?"Nenhum processo encontrado":"Nenhum processo cadastrado"}</h2><p>{search?"Tente outro termo de busca.":"Comece pelo processo que mais exige atenção hoje."}</p></div> :
    <section className="table-card">
      <div className="table-head matters"><span>Processo</span><span>Cliente</span><span>Próxima atenção</span><span>Status</span><span/></div>
      {matters.map(m=>{
        const deadline=m.deadlines[0]; const comm=m.communications[0];
        const attention=deadline ? deadline.title+(deadline.dueAt?" · "+deadline.dueAt.toLocaleDateString("pt-BR"):"") : comm ? (comm.title??comm.source) : "Sem pendência crítica";
        const danger=deadline?.risk==="CRITICAL"||deadline?.risk==="HIGH";
        return <Link href={"/app/processos/"+m.id} className="table-row matters" key={m.id}>
          <div className="matter-name"><span className="table-icon">{m.secrecy?<LockKeyhole size={15}/>:<BriefcaseBusiness size={16}/>}</span><div><strong>{m.number||m.internalCode||m.title}</strong><small>{m.title+(m.practiceArea?" · "+m.practiceArea:"")}</small></div></div>
          <span>{m.client?.name??"Sem cliente vinculado"}</span>
          <span>{attention}</span>
          <span className={"status-pill "+(danger?"danger":"success")}><CircleDot size={11}/>{danger?"Atenção":"Em dia"}</span>
          <ArrowUpRight size={16}/>
        </Link>
      })}
    </section>}
  </div>;
}
