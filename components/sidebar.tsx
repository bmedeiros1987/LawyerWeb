"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { openSearch } from "@/components/search/search-dialog";
import { detectMac, shortcutLabel } from "@/lib/ui/platform";
import { BellRing, BriefcaseBusiness, HardDrive, CalendarDays, ContactRound, FileStack, Landmark, LayoutDashboard, PlugZap, Search, ShieldCheck, Sparkles, UsersRound, ScrollText, Clock3, Gauge, ListTodo, MoreHorizontal, Settings } from "lucide-react";

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
  ["/app/configuracoes","Configurações",Settings],
] as const;

function Item({href,label,Icon}:{href:string;label:string;Icon:ComponentType<{size?:number;strokeWidth?:number}>}){
  const p=usePathname();
  const active=href==="/app"?p===href:p.startsWith(href);
  return <Link href={href} aria-current={active?"page":undefined} className={"side-link "+(active?"active":"")}><Icon size={18} strokeWidth={1.9}/><span>{label}</span></Link>
}

export function Sidebar({desktop=false}:{desktop?:boolean}){
  const more = useRef<HTMLDetailsElement>(null);
  const [shortcut, setShortcut] = useState("Ctrl+K");
  useEffect(() => { setShortcut(shortcutLabel("k")); detectMac().then(mac => setShortcut(shortcutLabel("k", mac))); }, []);
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
    <Link href="/app" className="side-brand"><img className="mblz-mark lawyermind-mark" src="/brand/lawyermind-symbol-cream.png" alt="LawyerMind"/><span className="side-brand-copy"><strong>LawyerMind</strong><small>Gestão jurídica</small></span></Link>
    <button type="button" className="command-button" onClick={openSearch} title={`Buscar em tudo (${shortcut})`}><Search size={16}/><span>Buscar em tudo</span><kbd aria-hidden>{shortcut}</kbd></button>
    <nav className="side-nav" aria-label="Navegação principal">
      <div className="side-section-title">Trabalho</div>
      <div className="side-group">{primary.map(([href,label,Icon])=><Item key={href} href={href} label={label} Icon={Icon}/>)}{desktop&&<Item href="/app/computador" label="Computador" Icon={HardDrive}/>}</div>
      <details ref={more} className="side-more">
        <summary><MoreHorizontal size={18}/><span>Mais</span></summary>
        <div className="side-more-menu"><Item href="/app/documentos" label="Documentos" Icon={FileStack}/>{secondary.filter(([href])=>!(desktop&&href==="/app/integrations")).map(([href,label,Icon])=><Item key={href} href={href} label={label} Icon={Icon}/>)}</div>
      </details>
    </nav>
    <div className="side-system-status"><ShieldCheck size={15}/><div><strong>Proteção de prazos</strong><span>monitoramento & escalonamento</span></div><i/></div>
  </aside>
}
