import Link from "next/link";
import { redirect } from "next/navigation";
import { Search } from "lucide-react";
import { auth } from "@/auth";
import { getActiveMembership } from "@/lib/workspace/context";
import { globalSearch, SEARCH_KINDS, type SearchKind } from "@/lib/search/global";
import { IndexNote } from "@/components/search/search-dialog";

export const dynamic = "force-dynamic";

const LABEL: Record<SearchKind, string> = { clients: "Clientes", matters: "Processos e assuntos", documents: "Documentos", content: "No conteúdo dos arquivos" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; tipo?: string }> }) {
  const session = await auth(); if (!session?.user?.id) redirect("/login");
  const member = await getActiveMembership(session.user.id); if (!member) redirect("/app/setup");
  const { q = "", tipo } = await searchParams;
  const kind = (SEARCH_KINDS as string[]).includes(tipo ?? "") ? tipo as SearchKind : null;
  let error = "";
  const result = await globalSearch(member, q, { kinds: kind ? [kind] : undefined, limit: 50 }).catch(e => { console.error("[search]", e); error = "A busca falhou. Tente novamente."; return null; });
  const href = (k: SearchKind | null) => `/app/busca?${new URLSearchParams({ q, ...(k ? { tipo: k } : {}) })}`;
  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">Busca</span><h1>Resultados</h1><p>Somente dados cadastrados que o seu perfil pode ver.</p></div></section>
    <form className="toolbar-card" action="/app/busca" method="get" role="search">
      <div className="search-field"><Search size={18} aria-hidden/><input name="q" defaultValue={q} placeholder="Cliente, processo, documento ou trecho de um contrato" aria-label="Termo de busca"/></div>
      {kind && <input type="hidden" name="tipo" value={kind}/>}
      <button className="new-button" type="submit">Buscar</button>
    </form>
    <nav className="search-filters" aria-label="Filtrar por tipo">
      <Link className={!kind ? "chip active" : "chip"} aria-current={!kind ? "page" : undefined} href={href(null)}>Tudo</Link>
      {SEARCH_KINDS.map(k => <Link key={k} className={kind === k ? "chip active" : "chip"} aria-current={kind === k ? "page" : undefined} href={href(k)}>{LABEL[k]}{result?.counts[k] !== undefined ? ` (${result.counts[k]})` : ""}</Link>)}
    </nav>
    {error && <p className="search-error" role="alert">{error}</p>}
    {result && q.trim().length < 2 && <p className="search-hint">Digite ao menos 2 caracteres.</p>}
    {result && q.trim().length >= 2 && result.hits.length === 0 && <div className="empty-state"><Search size={28}/><h2>Nenhum resultado para “{result.query}”</h2><p>Confira a grafia ou procure por outro dado (CPF/CNPJ, número do processo, nome do documento ou um trecho do texto).</p></div>}
    {result && SEARCH_KINDS.map(k => {
      const items = result.hits.filter(h => h.kind === k);
      if (!items.length) return null;
      return <section className="panel search-group" key={k}>
        <h2>{LABEL[k]} <small>{items.length < (result.counts[k] ?? 0) ? `${items.length} de ${result.counts[k]}` : items.length}</small></h2>
        <ul className="search-list">{items.map(h => <li key={h.kind + h.id}><Link href={h.href} className="search-hit"><strong>{h.title}</strong><span>{h.subtitle}</span>
          {h.excerpt && <q className="search-excerpt">…{h.excerpt.before}<mark>{h.excerpt.match}</mark>{h.excerpt.after}…</q>}</Link></li>)}</ul>
      </section>;
    })}
    {result && Object.entries(result.unavailable).map(([k, why]) => <p key={k} className="search-note">{LABEL[k as SearchKind]}: {why}</p>)}
    {result?.index && <IndexNote index={result.index}/>}
  </div>;
}
