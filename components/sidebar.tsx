"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { BellRing, BriefcaseBusiness, CalendarDays, ContactRound, FileStack, Landmark, LayoutDashboard, PlugZap, Search, ShieldCheck, Sparkles, UsersRound, ScrollText, Clock3, Gauge, ListTodo, MoreHorizontal } from "lucide-react";

const primary=[
  ["/app","Início",LayoutDashboard],
  ["/app/inbox","Caixa Jurídica",BellRing],
  ["/app/processos","Processos",BriefcaseBusiness],
  ["/app/agenda","Agenda",CalendarDays],
  ["/app/tarefas","Tarefas",ListTodo],
  ["/app/documentos","Documentos",FileStack],
] as const;

const secondary=[
  ["/app/prazos","Prazos",Clock3],
  ["/app/clientes","Clientes",ContactRound],
  ["/app/contratos","Contratos",ScrollText],
  ["/app/equipe","Equipe & acesso",UsersRound],
  ["/app/financeiro","Financeiro",Landmark],
  ["/app/relatorios","Relatórios",Gauge],
  ["/app/inteligencia","Intelligence",Sparkles],
  ["/app/integrations","Integrações",PlugZap],
] as const;

function Item({href,label,Icon}:{href:string;label:string;Icon:ComponentType<{size?:number;strokeWidth?:number}>}){
  const p=usePathname();
  const active=href==="/app"?p===href:p.startsWith(href);
  return <Link href={href} className={"side-link "+(active?"active":"")}><Icon size={18} strokeWidth={1.9}/><span>{label}</span></Link>
}

export function Sidebar(){
  return <aside className="sidebar">
    <Link href="/app" className="side-brand"><img className="mblz-mark" src="/brand/mblz-app-icon.svg" alt="MBLZ"/><span className="side-brand-copy"><strong>MBLZ</strong><small>Legal OS</small></span></Link>
    <button className="command-button"><Search size={16}/><span>Buscar em tudo</span><kbd>⌘ K</kbd></button>
    <nav className="side-nav">
      <div className="side-section-title">Trabalho</div>
      <div className="side-group">{primary.map(([href,label,Icon])=><Item key={href} href={href} label={label} Icon={Icon}/>)}</div>
      <details className="side-more">
        <summary><MoreHorizontal size={18}/><span>Mais</span></summary>
        <div className="side-more-menu">{secondary.map(([href,label,Icon])=><Item key={href} href={href} label={label} Icon={Icon}/>)}</div>
      </details>
    </nav>
    <div className="side-system-status"><ShieldCheck size={15}/><div><strong>Proteção de prazos</strong><span>monitoramento & escalonamento</span></div><i/></div>
  </aside>
}
