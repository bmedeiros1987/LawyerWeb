// Global search over what is actually stored: clients, matters (processos e
// assuntos) and documents, always through the same permission scopes as the
// list pages (RBAC + confidential matters). In the desktop app it also
// searches the text of imported working copies, and says which files were
// NOT searched (not indexed yet, scans without text, unsupported formats).
import { prisma } from "@/lib/prisma";
import { allows, documentScope, matterScope, type Viewer } from "@/lib/authz/visibility";
import { isDesktop } from "@/lib/desktop/env";

export type SearchKind = "clients" | "matters" | "documents" | "content";
export const SEARCH_KINDS: SearchKind[] = ["clients", "matters", "documents", "content"];

export type SearchHit = { kind: SearchKind; id: string; title: string; subtitle: string; href: string; excerpt?: { before: string; match: string; after: string }; version?: number; page?: number | null };
export type SearchResult = {
  query: string;
  hits: SearchHit[];
  counts: Partial<Record<SearchKind, number>>;
  /** Kinds this account may not search (no permission) or that do not exist here (content on the web). */
  unavailable: Partial<Record<SearchKind, string>>;
  index?: { indexed: number; total: number; notSearched: { documentId: string; name: string; version: number; status: string; note: string | null }[] };
};

const like = (q: string) => ({ contains: q, mode: "insensitive" as const });

export async function globalSearch(viewer: Viewer, rawQuery: string, opts: { kinds?: SearchKind[]; limit?: number } = {}): Promise<SearchResult> {
  const query = rawQuery.trim().replace(/\s+/g, " ").slice(0, 200);
  const kinds = new Set(opts.kinds?.length ? opts.kinds : SEARCH_KINDS);
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 50);
  const result: SearchResult = { query, hits: [], counts: {}, unavailable: {} };
  if (query.length < 2) return result;
  const ws = viewer.workspaceId;

  if (kinds.has("clients")) {
    if (!allows(viewer, "clients.view")) result.unavailable.clients = "Seu perfil não consulta clientes.";
    else {
      const digits = query.replace(/\D/g, "");
      const where = { workspaceId: ws, OR: [{ name: like(query) }, { legalName: like(query) }, { email: like(query) }, ...(digits.length >= 3 ? [{ cpfCnpj: { contains: digits } }] : [])] };
      const [rows, n] = await Promise.all([
        prisma.client.findMany({ where, select: { id: true, name: true, legalName: true, cpfCnpj: true, type: true }, orderBy: { name: "asc" }, take: limit }),
        prisma.client.count({ where }),
      ]);
      result.counts.clients = n;
      for (const c of rows) result.hits.push({ kind: "clients", id: c.id, title: c.name, subtitle: [c.type === "INDIVIDUAL" ? "Pessoa física" : "Pessoa jurídica", c.legalName, c.cpfCnpj].filter(Boolean).join(" · "), href: `/app/clientes/${c.id}` });
    }
  }

  if (kinds.has("matters")) {
    if (!allows(viewer, "matters.view")) result.unavailable.matters = "Seu perfil não consulta processos.";
    else {
      const where = { AND: [matterScope(viewer), { OR: [{ number: like(query) }, { internalCode: like(query) }, { title: like(query) }, { client: { name: like(query) } }] }] };
      const [rows, n] = await Promise.all([
        prisma.matter.findMany({ where, select: { id: true, title: true, number: true, internalCode: true, type: true, client: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: limit }),
        prisma.matter.count({ where }),
      ]);
      result.counts.matters = n;
      for (const m of rows) result.hits.push({ kind: "matters", id: m.id, title: m.title, subtitle: [m.number ?? m.internalCode, m.client?.name, m.type === "LITIGATION" ? "Contencioso" : "Consultivo/assunto"].filter(Boolean).join(" · "), href: `/app/processos/${m.id}` });
    }
  }

  const canDocs = allows(viewer, "documents.view");
  if (kinds.has("documents")) {
    if (!canDocs) result.unavailable.documents = "Seu perfil não consulta documentos.";
    else {
      const where = { AND: [documentScope(viewer), { OR: [{ name: like(query) }, { kind: like(query) }, { versions: { some: { originalName: like(query) } } }, { client: { name: like(query) } }, { matter: { title: like(query) } }] }] };
      const [rows, n] = await Promise.all([
        prisma.legalDocument.findMany({ where, select: { id: true, name: true, kind: true, currentVersion: true, client: { select: { name: true } }, matter: { select: { title: true } } }, orderBy: { updatedAt: "desc" }, take: limit }),
        prisma.legalDocument.count({ where }),
      ]);
      result.counts.documents = n;
      for (const d of rows) result.hits.push({ kind: "documents", id: d.id, title: d.name, subtitle: [`versão ${d.currentVersion}`, d.matter?.title ?? d.client?.name].filter(Boolean).join(" · "), href: `/app/documentos/${d.id}` });
    }
  }

  if (kinds.has("content")) {
    if (!canDocs) result.unavailable.content = "Seu perfil não consulta documentos.";
    else if (!isDesktop()) result.unavailable.content = "A busca no conteúdo dos arquivos existe no aplicativo desktop, onde as cópias de trabalho ficam no computador.";
    else await contentSearch(viewer, query, limit, result);
  }
  return result;
}

async function contentSearch(viewer: Viewer, query: string, limit: number, result: SearchResult) {
  const { fold, indexState, refreshIndex } = await import("@/lib/desktop/textindex");
  const versions = await prisma.documentVersion.findMany({ where: { source: "DESKTOP_IMPORT", document: documentScope(viewer) }, select: { id: true }, take: 20_000 });
  const ids = versions.map(v => v.id);
  await refreshIndex(ids);
  const state = await indexState(ids);
  result.index = { indexed: state.indexed, total: state.total, notSearched: state.notSearched.slice(0, 50) };
  if (!state.indexed) { result.counts.content = 0; return; }
  const q = fold(query);
  const rows = await prisma.$queryRaw<{ version_id: string; version: number; document_id: string; name: string; pos: number; content: string; pages: number | null; total: bigint }[]>`
    with hits as (
      select t.version_id, t.content, t.pages, strpos(t.folded, ${q}) as pos,
             ts_rank(t.tsv, websearch_to_tsquery('portuguese', ${q})) as rank
      from desktop.document_text t
      where t.version_id = any(${ids}) and t.status = 'indexed'
        and (strpos(t.folded, ${q}) > 0 or t.tsv @@ websearch_to_tsquery('portuguese', ${q}))
    )
    select h.version_id, v.version, v."documentId" as document_id, d.name, h.pos,
           substring(h.content from greatest(1, h.pos - 90) for 240) as content, h.pages,
           count(*) over () as total
    from hits h join "DocumentVersion" v on v.id = h.version_id join "LegalDocument" d on d.id = v."documentId"
    order by (h.pos > 0) desc, h.rank desc, d."updatedAt" desc
    limit ${limit}`;
  result.counts.content = Number(rows[0]?.total ?? 0);
  for (const r of rows) {
    let excerpt: SearchHit["excerpt"]; let page: number | null = null;
    if (r.pos > 0) {
      const start = Math.max(1, r.pos - 90);
      const rel = r.pos - start;
      excerpt = { before: r.content.slice(0, rel).replace(/\f/g, " "), match: r.content.slice(rel, rel + query.length), after: r.content.slice(rel + query.length).replace(/\f/g, " ") };
      if (r.pages) page = await pageOf(r.version_id, r.pos);
    }
    result.hits.push({ kind: "content", id: r.version_id, title: r.name, subtitle: `versão ${r.version}${page ? ` · página ${page}` : ""}${r.pos > 0 ? "" : " · termos relacionados"}`, href: `/app/documentos/${r.document_id}?versao=${r.version_id}`, excerpt, version: r.version, page });
  }
}

async function pageOf(versionId: string, pos: number): Promise<number> {
  const r = await prisma.$queryRaw<{ n: number }[]>`select (length(substring(content for ${pos})) - length(replace(substring(content for ${pos}), chr(12), '')) + 1)::int as n from desktop.document_text where version_id = ${versionId}`;
  return r[0]?.n ?? 1;
}
