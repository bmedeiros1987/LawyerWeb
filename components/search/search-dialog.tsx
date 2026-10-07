"use client";
// Search window: opened by the "Buscar em tudo" button, the search icon in the
// top bar, or Ctrl+K / ⌘K. Queries /api/search (real data, permission
// scoped); shows only the answer to what is typed now (never the previous
// query's hits while a new one is pending) and ignores late responses; keyboard: ↑/↓ to move, Enter to open,
// Esc to close.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BriefcaseBusiness, ContactRound, FileSearch, FileText, Loader2, Search, X } from "lucide-react";
import type { SearchHit, SearchKind, SearchResult } from "@/lib/search/global";
import { detectMac, isMacPlatform, primaryModifier, shortcutLabel } from "@/lib/ui/platform";
import { normalizeQuery, searchKey } from "@/lib/search/query-key";

export const OPEN_SEARCH_EVENT = "lawyermind:open-search";
export const openSearch = () => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));

const FILTERS: { kind: SearchKind | "all"; label: string }[] = [
  { kind: "all", label: "Tudo" },
  { kind: "clients", label: "Clientes" },
  { kind: "matters", label: "Processos e assuntos" },
  { kind: "documents", label: "Documentos" },
  { kind: "content", label: "No conteúdo" },
];
const GROUP: Record<SearchKind, { label: string; Icon: typeof Search }> = {
  clients: { label: "Clientes", Icon: ContactRound },
  matters: { label: "Processos e assuntos", Icon: BriefcaseBusiness },
  documents: { label: "Documentos", Icon: FileText },
  content: { label: "No conteúdo dos arquivos", Icon: FileSearch },
};
const STATUS_LABEL: Record<string, string> = { pending: "ainda não indexado", no_text: "sem texto (precisa de OCR)", unsupported: "formato não lido", error: "erro de leitura" };

export function SearchDialog() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<SearchKind | "all">("all");
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "error"; key?: string; result?: SearchResult; error?: string }>({ status: "idle" });
  const [active, setActive] = useState(0);
  const [mac, setMac] = useState(false);
  const macRef = useRef(false);
  useEffect(() => {
    macRef.current = isMacPlatform(); setMac(macRef.current);
    detectMac().then(m => { macRef.current = m; setMac(m); });
  }, []);

  const open = useCallback(() => {
    const d = dialog.current; if (!d) return;
    if (!d.open) d.showModal();
    requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
  }, []);
  const close = () => dialog.current?.close();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && !e.repeat && !e.shiftKey && primaryModifier(e, macRef.current)) { e.preventDefault(); open(); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, open);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(OPEN_SEARCH_EVENT, open); };
  }, [open]);

  const run = useCallback(async (query: string, kind: SearchKind | "all") => {
    const id = ++seq.current;
    if (normalizeQuery(query).length < 2) { setState({ status: "idle" }); return; }
    const key = searchKey(query, kind);
    setState({ status: "loading", key });
    try {
      const params = new URLSearchParams({ q: query, limit: "8" });
      if (kind !== "all") params.set("kinds", kind);
      const r = await fetch(`/api/search?${params}`, { headers: { accept: "application/json" } });
      const body = await r.json().catch(() => ({}));
      if (id !== seq.current) return; // a newer query was typed: drop this late answer
      if (!r.ok) { setState({ status: "error", key, error: body.error ?? `Erro ${r.status}` }); return; }
      setState({ status: "done", key, result: body }); setActive(0);
    } catch {
      if (id === seq.current) setState({ status: "error", key, error: "Sem resposta do servidor local. Tente novamente." });
    }
  }, []);

  useEffect(() => { setActive(0); const t = setTimeout(() => run(q, filter), 220); return () => clearTimeout(t); }, [q, filter, run]);

  // Only the answer to the current query and filter is shown; anything else
  // (debounce window, request in flight, late answer) reads as "Buscando…".
  const typed = normalizeQuery(q).length >= 2;
  const current = typed && state.key === searchKey(q, filter) ? state : null;
  const status: "idle" | "loading" | "done" | "error" = !typed ? "idle" : current && current.status !== "loading" ? current.status : "loading";
  const result = status === "done" ? current?.result : undefined;
  const hits = useMemo(() => result?.hits ?? [], [result]);
  const go = (h: SearchHit) => { close(); router.push(h.href); };
  const allHref = `/app/busca?${new URLSearchParams({ q, ...(filter !== "all" ? { tipo: filter } : {}) })}`;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && hits[active]) { e.preventDefault(); go(hits[active]); }
  }

  const groups = (Object.keys(GROUP) as SearchKind[]).map(k => ({ k, items: hits.map((h, i) => ({ h, i })).filter(x => x.h.kind === k) })).filter(g => g.items.length);

  return <dialog ref={dialog} className="search-dialog" aria-label="Buscar em tudo" onClick={e => { if (e.target === dialog.current) close(); }}>
    <div className="search-box" onKeyDown={onKeyDown}>
      <div className="search-input-row">
        <Search size={20} aria-hidden/>
        <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Cliente, processo, documento ou trecho de um contrato" aria-label="Termo de busca"
          role="combobox" aria-expanded={hits.length > 0} aria-controls="search-results" aria-activedescendant={hits[active] ? `search-hit-${active}` : undefined} autoComplete="off" spellCheck={false}/>
        {status === "loading" && <Loader2 size={18} className="spin" aria-label="Buscando"/>}
        <button type="button" className="icon-button" onClick={close} aria-label="Fechar busca" title="Fechar (Esc)"><X size={18}/></button>
      </div>
      <div className="search-filters" role="group" aria-label="Filtrar por tipo">
        {FILTERS.map(f => <button type="button" key={f.kind} aria-pressed={filter === f.kind} className={filter === f.kind ? "chip active" : "chip"} onClick={() => setFilter(f.kind)}>
          {f.label}{result && f.kind !== "all" && result.counts[f.kind] !== undefined ? ` (${result.counts[f.kind]})` : ""}</button>)}
      </div>
      <div className="search-results" id="search-results" role="listbox" aria-label="Resultados">
        {status === "idle" && <p className="search-hint">Digite ao menos 2 caracteres. A busca consulta clientes, processos e assuntos, documentos e o texto dos arquivos importados, respeitando as suas permissões. Atalho: {shortcutLabel("k", mac)}.</p>}
        {status === "loading" && <p className="search-loading" role="status">Buscando…</p>}
        {status === "error" && <p className="search-error" role="alert"><AlertTriangle size={16}/> {current?.error} <button type="button" className="link-button" onClick={() => run(q, filter)}>Tentar de novo</button></p>}
        {status === "done" && hits.length === 0 && <p className="search-empty">Nenhum resultado para “{result?.query}”{filter !== "all" ? ` em ${FILTERS.find(f => f.kind === filter)?.label.toLowerCase()}` : ""}.</p>}
        {groups.map(g => { const { label, Icon } = GROUP[g.k]; return <section key={g.k} className="search-group">
          <h3><Icon size={15} aria-hidden/> {label}{result?.counts[g.k] && result.counts[g.k]! > g.items.length ? ` — ${g.items.length} de ${result.counts[g.k]}` : ""}</h3>
          {g.items.map(({ h, i }) => <div key={h.kind + h.id} id={`search-hit-${i}`} role="option" aria-selected={i === active} className={i === active ? "search-hit active" : "search-hit"} onMouseEnter={() => setActive(i)} onClick={() => go(h)}>
            <strong>{h.title}</strong><span>{h.subtitle}</span>
            {h.excerpt && <q className="search-excerpt">…{h.excerpt.before}<mark>{h.excerpt.match}</mark>{h.excerpt.after}…</q>}
          </div>)}
        </section>; })}
        {result && Object.entries(result.unavailable).filter(([k]) => filter === "all" || filter === k).map(([k, why]) => <p key={k} className="search-note">{GROUP[k as SearchKind].label}: {why}</p>)}
        {result?.index && (filter === "all" || filter === "content") && <IndexNote index={result.index}/>}
      </div>
      {q.trim().length >= 2 && <div className="search-footer"><a href={allHref} onClick={e => { e.preventDefault(); close(); router.push(allHref); }}>Ver todos os resultados</a><span>↑↓ navegar · Enter abrir · Esc fechar</span></div>}
    </div>
  </dialog>;
}

export function IndexNote({ index }: { index: NonNullable<SearchResult["index"]> }) {
  const missing = index.total - index.indexed;
  if (!index.total) return <p className="search-note">Nenhum arquivo importado neste computador: não há conteúdo para pesquisar.</p>;
  return <details className="search-note">
    <summary>Conteúdo pesquisado em {index.indexed} de {index.total} arquivo(s).{missing ? ` ${missing} não foram pesquisados.` : ""}</summary>
    {missing > 0 && <ul>{index.notSearched.map(n => <li key={n.documentId + n.version}>{n.name} (versão {n.version}): {STATUS_LABEL[n.status] ?? n.status}{n.note ? ` — ${n.note}` : ""}</li>)}</ul>}
  </details>;
}
