import { redirect } from "next/navigation";
import { BookOpenCheck, FileSearch, LockKeyhole, Sparkles, WandSparkles } from "lucide-react";
import { auth } from "@/auth";
import { P, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";
import { openClawConfigured } from "@/lib/openclaw/client";
import { AgentChat } from "@/components/agent-chat";

const prompts=[
  [FileSearch,"Resuma o que mudou","Compare movimentações e destaque somente o que exige ação."],
  [BookOpenCheck,"Revise o contexto","Cruze prazos, tarefas e assuntos recentes sem inventar informações."],
  [WandSparkles,"Prepare um rascunho","Monte uma primeira versão para revisão humana antes de qualquer envio."],
] as const;

export const dynamic="force-dynamic";

export default async function Page(){
  const session=await auth(); if(!session?.user?.id)redirect("/login");
  const member=await getActiveMembership(session.user.id); if(!member)redirect("/app/setup");
  if(!await memberWithPermission(session.user.id,member.workspaceId,P.AGENT_USE)){
    return <div className="empty-state"><LockKeyhole size={28}/><h2>Acesso restrito</h2><p>Seu perfil não possui permissão para usar o MBLZ Agent.</p></div>;
  }
  const configured=openClawConfigured();
  return <div className="page-stack ai-page">
    <section className="ai-hero compact">
      <div className="mblz-ai-orb" style={{margin:"0 auto 16px"}}><Sparkles size={22}/></div>
      <span className="eyebrow">MBLZ Agent · OpenClaw</span>
      <h1>Seu agente jurídico, dentro do MBLZ.</h1>
      <p>O contexto respeita o seu perfil, o sigilo dos processos e as regras do Deadline Safety. Canais externos são opcionais.</p>
    </section>
    <AgentChat configured={configured}/>
    <section className="prompt-grid">{prompts.map(([Icon,t,d])=><article className="prompt-card" key={t}><Icon size={21}/><strong>{t}</strong><span>{d}</span></article>)}</section>
  </div>;
}
