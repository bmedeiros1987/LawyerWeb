import { contractScope, documentScope } from "@/lib/authz/visibility";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, LockKeyhole, Search, UserRound } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";
import { QuickClientForm } from "@/components/legal-quick-create";

export const dynamic="force-dynamic";

export default async function Page({searchParams}:{searchParams:Promise<{q?:string}>}) {
  const session=await auth(); if(!session?.user?.id) redirect("/login");
  const member=await getActiveMembership(session.user.id); if(!member) redirect("/app/setup");
  if(!(await memberWithPermission(session.user.id,member.workspaceId,P.CLIENTS_VIEW))) {
    return <div className="empty-state"><LockKeyhole size={28}/><h2>Acesso restrito</h2><p>Seu perfil não possui permissão para consultar clientes.</p></div>;
  }
  const canEdit=Boolean(await memberWithPermission(session.user.id,member.workspaceId,P.CLIENTS_EDIT));
  const {q=""}=await searchParams; const search=q.trim();
  const clients=await prisma.client.findMany({
    where:{workspaceId:member.workspaceId,...(search?{OR:[
      {name:{contains:search,mode:"insensitive" as const}},
      {legalName:{contains:search,mode:"insensitive" as const}},
      {cpfCnpj:{contains:search.replace(/\D/g,"")}},
      {email:{contains:search,mode:"insensitive" as const}},
    ]}:{})},
    include:{
      matters:{where:{OR:[{secrecy:false},{access:{some:{memberId:member.id}}}]},select:{id:true}},
      _count:{select:{documents:{where:documentScope(member)},contracts:{where:contractScope(member)}}},
    },
    orderBy:{name:"asc"},take:250,
  });

  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">Relacionamento</span><h1>Clientes</h1><p>Uma ficha única para histórico, processos, contratos, documentos e trabalho realizado.</p></div>{canEdit&&<QuickClientForm workspaceId={member.workspaceId}/>}</section>
    <form className="toolbar-card" action="/app/clientes" method="get"><div className="search-field"><Search size={17}/><input name="q" defaultValue={search} placeholder="Nome, CPF, CNPJ ou e-mail"/></div></form>
    {clients.length===0?<div className="empty-state"><Building2 size={28}/><h2>{search?"Nenhum cliente encontrado":"Nenhum cliente cadastrado"}</h2><p>Cadastre uma pessoa ou empresa uma única vez e reutilize esse vínculo em todos os assuntos.</p></div>:
    <section className="client-grid">{clients.map((c)=><Link className="client-card" href={"/app/clientes/"+c.id} key={c.id}>
      <div className="client-avatar">{c.type==="INDIVIDUAL"?<UserRound size={20}/>:<Building2 size={20}/>}</div>
      <div><strong>{c.name}</strong><span>{c.type==="INDIVIDUAL"?"Pessoa física":"Pessoa jurídica"}{c.cpfCnpj?" · "+c.cpfCnpj:""}</span></div>
      <div className="client-stats"><span><b>{c.matters.length}</b>processos</span><span><b>{c._count.contracts+c._count.documents}</b>docs/contratos</span></div>
    </Link>)}</section>}
  </div>;
}
