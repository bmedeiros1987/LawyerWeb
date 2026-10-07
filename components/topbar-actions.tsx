"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { openSearch } from "@/components/search/search-dialog";
import { shortcutLabel } from "@/lib/ui/platform";

const NEW_ITEMS = [
  ["/app/clientes#novo", "Cliente"],
  ["/app/processos#novo", "Processo ou assunto"],
  ["/app/documentos#novo", "Documento"],
  ["/app/tarefas#novo", "Tarefa"],
] as const;

/** Search and "Novo" menu of the top bar. Every item leads to a working form. */
export function TopbarActions() {
  const menu = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  const [shortcut, setShortcut] = useState("Ctrl+K");
  useEffect(() => setShortcut(shortcutLabel("k")), []);
  useEffect(() => { if (menu.current) menu.current.open = false; }, [pathname]);
  return <>
    <button type="button" className="icon-button" onClick={openSearch} aria-label="Buscar em tudo" title={`Buscar em tudo (${shortcut})`}><Search size={18}/></button>
    <details ref={menu} className="account-menu new-menu">
      <summary className="new-button"><Plus size={17}/>Novo</summary>
      <div className="account-popover" role="menu">{NEW_ITEMS.map(([href, label]) => <Link role="menuitem" key={href} href={href} onClick={() => { if (menu.current) menu.current.open = false; }}>{label}</Link>)}</div>
    </details>
  </>;
}
