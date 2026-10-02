"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ComponentType } from "react";
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
  return <Link href={href} aria-current={active?"page":undefined} className={"side-link "+(active?"active":"")}><Icon size={18} strokeWidth={1.9}/><span>{label}</span></Link>
}

export function Sidebar(){
  const more = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => { if (more.current) more.current.open = false; }, [pathname]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && more.current?.open) {
        more.current.open = false;
        more.current.querySelector("summary")?.focus();
      }
    };
    const outside = (event: PointerEvent) => {
      if (more.current?.open && !more.current.contains(event.target as Node)) more.current.open = false;
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", outside); };
  }, []);
  return <aside className="sidebar">
    <Link href="/app" className="side-brand"><img className="mblz-mark" src="/brand/mblz-app-icon.svg" alt="MBLZ"/><span className="side-brand-copy"><strong>MBLZ</strong><small>MBLZ · Legal OS</small></span></Link>
    <button className="command-button"><Search size={16}/><span>Buscar em tudo</span><kbd>⌘ K</kbd></button>
    <nav className="side-nav" aria-label="Navegação principal">
      <div className="side-section-title">Trabalho</div>
      <div className="side-group">{primary.map(([href,label,Icon])=><Item key={href} href={href} label={label} Icon={Icon}/>)}</div>
      <details ref={more} className="side-more">
        <summary><MoreHorizontal size={18}/><span>Mais</span></summary>
        <div className="side-more-menu"><Item href="/app/documentos" label="Documentos" Icon={FileStack}/>{secondary.map(([href,label,Icon])=><Item key={href} href={href} label={label} Icon={Icon}/>)}</div>
      </details>
    </nav>
    <div className="side-system-status"><ShieldCheck size={15}/><div><strong>Proteção de prazos</strong><span>monitoramento & escalonamento</span></div><i/></div>
  </aside>
}
