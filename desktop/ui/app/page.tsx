"use client";

import { FormEvent, useCallback, useEffect, useState, type ComponentType } from "react";
import {
  Archive, ArchiveRestore, BriefcaseBusiness, Building2, CheckCircle2, ContactRound, DatabaseBackup, ExternalLink,
  FileStack, FolderOpen, HardDrive, LayoutDashboard, Plus, Search, Settings, ShieldCheck, TriangleAlert,
} from "lucide-react";
import {
  api, errorText, formatBytes, formatDate,
  type BackupReport, type Client, type ClientInput, type Doc, type Manifest, type Matter, type MatterInput, type RestoreReport, type RootCheck, type Status,
} from "@/lib/api";

type View = "home" | "clients" | "matters" | "documents" | "backup" | "settings";
type IconT = ComponentType<{ size?: number; strokeWidth?: number }>;

const NAV: [View, string, IconT][] = [
  ["home", "Início", LayoutDashboard],
  ["clients", "Clientes", ContactRound],
  ["matters", "Processos", BriefcaseBusiness],
  ["documents", "Documentos", FileStack],
  ["backup", "Backup", DatabaseBackup],
  ["settings", "Configurações", Settings],
];

const MATTER_TYPES: [string, string][] = [
  ["LITIGATION", "Contencioso"], ["ADVISORY", "Consultivo"], ["ADMINISTRATIVE", "Administrativo"], ["OTHER", "Outro"],
];

function ErrorLine({ message }: { message: string }) {
  return message ? <p className="form-error">{message}</p> : null;
}

function Banner({ tone, children }: { tone?: "danger" | "success"; children: React.ReactNode }) {
  return <div className={"desktop-banner " + (tone ?? "")}>{tone === "danger" ? <TriangleAlert size={16} /> : tone === "success" ? <CheckCircle2 size={16} /> : <ShieldCheck size={16} />}<div>{children}</div></div>;
}

function useAsync() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setError("");
    try { return await fn(); } catch (e) { setError(errorText(e)); return undefined; } finally { setBusy(false); }
  }, []);
  return { busy, error, setError, run };
}

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || undefined;

// ---------------------------------------------------------------------------

export default function DesktopApp() {
  const [view, setView] = useState<View>("home");
  const [status, setStatus] = useState<Status | null>(null);
  const [bootError, setBootError] = useState("");
  const [focusClient, setFocusClient] = useState<string | null>(null);
  const [focusMatter, setFocusMatter] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try { const s = await api.status(); setStatus(s); setBootError(""); return s; } catch (e) { setBootError(errorText(e)); return null; }
  }, []);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const s = await refreshStatus();
      if (!stop && (!s || (!s.ready && !s.error))) setTimeout(tick, 600);
    };
    tick();
    return () => { stop = true; };
  }, [refreshStatus]);

  const go = (v: View, opts?: { client?: string | null; matter?: string | null }) => {
    setFocusClient(opts?.client ?? null); setFocusMatter(opts?.matter ?? null); setView(v); refreshStatus();
  };

  const ready = Boolean(status?.ready);

  return <div className="app-frame">
    <aside className="sidebar">
      <div className="side-brand"><img className="mblz-mark" src="/brand/mblz-app-icon.svg" alt="MBLZ" /><span className="side-brand-copy"><strong>LawyerMind</strong><small>MBLZ · Desktop local</small></span></div>
      <nav className="side-nav" aria-label="Navegação principal">
        <div className="side-section-title">Escritório</div>
        <div className="side-group">{NAV.map(([v, label, Icon]) =>
          <button key={v} type="button" onClick={() => go(v)} aria-current={view === v ? "page" : undefined} className={"side-link " + (view === v ? "active" : "")}><Icon size={18} strokeWidth={1.9} /><span>{label}</span></button>)}
        </div>
      </nav>
      <div className="side-system-status"><HardDrive size={15} /><div><strong>{ready ? "Banco local ativo" : status?.error ? "Banco local com erro" : "Iniciando banco local"}</strong><span>sem servidor · sem internet</span></div><i style={ready ? undefined : { background: status?.error ? "#9E3F2C" : "#C9A24A" }} /></div>
    </aside>
    <div className="workspace-frame">
      <header className="topbar">
        <div className="topbar-title"><span className="eyebrow">LawyerMind Desktop</span><strong>Escritório local</strong></div>
        <div className="topbar-actions">
          <span className={"status-pill " + (ready ? "success" : status?.error ? "danger" : "quiet")}>{ready ? `PostgreSQL ${status?.postgres_version ?? ""} local` : status?.error ? "Erro no banco local" : "Iniciando…"}</span>
        </div>
      </header>
      <main className="workspace-content">
        {bootError && <Banner tone="danger"><strong>Este aplicativo precisa ser aberto pelo LawyerMind Desktop.</strong> {bootError}</Banner>}
        {status?.error && <Banner tone="danger"><strong>O banco local não iniciou.</strong> {status.error}<br />Pasta interna: <span className="desktop-path">{status.state_dir}</span></Banner>}
        {!status?.error && !ready && !bootError && <div className="empty-state"><HardDrive size={28} /><h2>Preparando o banco local</h2><p>Na primeira execução o PostgreSQL local é inicializado neste computador. Isso leva alguns segundos.</p></div>}
        {ready && status && <>
          {view === "home" && <Home status={status} go={go} />}
          {view === "clients" && <ClientsView status={status} focus={focusClient} go={go} onChange={refreshStatus} />}
          {view === "matters" && <MattersView status={status} focus={focusMatter} go={go} onChange={refreshStatus} />}
          {view === "documents" && <DocumentsView status={status} go={go} onChange={refreshStatus} />}
          {view === "backup" && <BackupView status={status} onChange={refreshStatus} />}
          {view === "settings" && <SettingsView status={status} onChange={refreshStatus} />}
        </>}
      </main>
    </div>
  </div>;
}

type GoFn = (v: View, opts?: { client?: string | null; matter?: string | null }) => void;

// ---------------------------------------------------------------------------

function DocumentsRootWarning({ status, go }: { status: Status; go: GoFn }) {
  if (!status.documents_root) return <Banner tone="danger"><strong>Escolha a pasta de documentos.</strong> Os arquivos ficam numa pasta deste computador escolhida por você. <button className="ghost-button" onClick={() => go("settings")}>Abrir Configurações</button></Banner>;
  const c = status.documents_check;
  if (c && (!c.exists || c.missing > 0)) return <Banner tone="danger"><strong>{c.exists ? `${c.missing} documento(s) não encontrados na pasta atual.` : "A pasta de documentos não está acessível."}</strong> Se a pasta foi movida ou o disco mudou de letra, use Relocalizar pasta. <button className="ghost-button" onClick={() => go("settings")}>Relocalizar</button></Banner>;
  return null;
}

function Home({ status, go }: { status: Status; go: GoFn }) {
  const c = status.counts;
  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">Local-first</span><h1>Início</h1><p>Tudo neste computador: banco PostgreSQL local, documentos em pasta escolhida por você e backup verificável.</p></div></section>
    <DocumentsRootWarning status={status} go={go} />
    <section className="client-grid">
      <button className="client-card" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => go("clients")}><div className="client-avatar"><ContactRound size={20} /></div><strong>Clientes</strong><span>{c?.clients ?? 0} cadastrados</span></button>
      <button className="client-card" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => go("matters")}><div className="client-avatar"><BriefcaseBusiness size={20} /></div><strong>Processos</strong><span>{c?.matters ?? 0} cadastrados</span></button>
      <button className="client-card" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => go("documents")}><div className="client-avatar"><FileStack size={20} /></div><strong>Documentos</strong><span>{c?.documents ?? 0} na pasta local</span></button>
      <button className="client-card" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => go("backup")}><div className="client-avatar"><DatabaseBackup size={20} /></div><strong>Backup</strong><span>banco + documentos</span></button>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">Onde estão seus dados</span><h2>Armazenamento local</h2></div><ShieldCheck size={16} /></div>
      <dl className="detail-list">
        <div><dt>Banco de dados</dt><dd className="desktop-path">{status.database_dir}</dd></div>
        <div><dt>Pasta de documentos</dt><dd className="desktop-path">{status.documents_root ?? "não definida"}</dd></div>
        <div><dt>Servidor</dt><dd>PostgreSQL {status.postgres_version} em 127.0.0.1 (somente este computador)</dd></div>
        <div><dt>Internet</dt><dd>não utilizada · nenhum dado é enviado</dd></div>
        <div><dt>Versão</dt><dd>LawyerMind {status.app_version} · esquema {status.schema_version}</dd></div>
      </dl>
    </section>
  </div>;
}

// ---------------------------------------------------------------------------

function ClientForm({ initial, onSaved, onCancel }: { initial?: Client; onSaved: (c: Client) => void; onCancel?: () => void }) {
  const { busy, error, run } = useAsync();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const input: ClientInput = { type: String(fd.get("type")), name: String(fd.get("name") ?? ""), legal_name: text(fd, "legal_name"), cpf_cnpj: text(fd, "cpf_cnpj"), email: text(fd, "email"), phone: text(fd, "phone"), notes: text(fd, "notes") };
    const saved = await run(() => initial ? api.updateClient(initial.id, input) : api.createClient(input));
    if (saved) { if (!initial) form.reset(); onSaved(saved); }
  }
  return <form className="desktop-form" onSubmit={submit} key={initial?.id ?? "new"}>
    <div className="quick-form-grid">
      <label><span>Tipo</span><select name="type" defaultValue={initial?.type ?? "LEGAL_ENTITY"}><option value="LEGAL_ENTITY">Pessoa jurídica</option><option value="INDIVIDUAL">Pessoa física</option></select></label>
      <label><span>CPF/CNPJ</span><input name="cpf_cnpj" defaultValue={initial?.cpf_cnpj ?? ""} placeholder="Opcional" /></label>
    </div>
    <label><span>Nome</span><input name="name" required defaultValue={initial?.name ?? ""} placeholder="Nome ou razão de uso" /></label>
    <label><span>Razão social / nome completo</span><input name="legal_name" defaultValue={initial?.legal_name ?? ""} placeholder="Opcional" /></label>
    <div className="quick-form-grid">
      <label><span>E-mail</span><input name="email" type="email" defaultValue={initial?.email ?? ""} placeholder="Opcional" /></label>
      <label><span>Telefone</span><input name="phone" defaultValue={initial?.phone ?? ""} placeholder="Opcional" /></label>
    </div>
    <label><span>Observações</span><textarea name="notes" rows={3} defaultValue={initial?.notes ?? ""} /></label>
    <ErrorLine message={error} />
    <div className="desktop-actions"><button className="form-submit" style={{ padding: "0 16px" }} disabled={busy}>{busy ? "Salvando…" : initial ? "Salvar alterações" : "Cadastrar cliente"}</button>{onCancel && <button type="button" className="filter-button" onClick={onCancel}>Cancelar</button>}</div>
  </form>;
}

function MatterForm({ initial, clients, fixedClient, onSaved, onCancel }: { initial?: Matter; clients: Client[]; fixedClient?: string; onSaved: (m: Matter) => void; onCancel?: () => void }) {
  const { busy, error, run } = useAsync();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const input: MatterInput = { client_id: fixedClient ?? String(fd.get("client_id") ?? ""), number: text(fd, "number"), title: String(fd.get("title") ?? ""), type: String(fd.get("type")), practice_area: text(fd, "practice_area"), court: text(fd, "court"), jurisdiction: text(fd, "jurisdiction"), notes: text(fd, "notes") };
    const saved = await run(() => initial ? api.updateMatter(initial.id, input) : api.createMatter(input));
    if (saved) { if (!initial) form.reset(); onSaved(saved); }
  }
  return <form className="desktop-form" onSubmit={submit} key={initial?.id ?? "new"}>
    {!fixedClient && <label><span>Cliente</span><select name="client_id" required defaultValue={initial?.client_id ?? ""}><option value="" disabled>Selecione</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    <div className="quick-form-grid">
      <label><span>Número (CNJ)</span><input name="number" defaultValue={initial?.number ?? ""} placeholder="0000000-00.0000.0.00.0000" /></label>
      <label><span>Tipo</span><select name="type" defaultValue={initial?.type ?? "LITIGATION"}>{MATTER_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    </div>
    <label><span>Título / assunto</span><input name="title" required defaultValue={initial?.title ?? ""} placeholder="Ex.: Ação de cobrança" /></label>
    <div className="quick-form-grid">
      <label><span>Área</span><input name="practice_area" defaultValue={initial?.practice_area ?? ""} placeholder="Opcional" /></label>
      <label><span>Vara / tribunal</span><input name="court" defaultValue={initial?.court ?? ""} placeholder="Opcional" /></label>
    </div>
    <label><span>Comarca / jurisdição</span><input name="jurisdiction" defaultValue={initial?.jurisdiction ?? ""} placeholder="Opcional" /></label>
    <label><span>Observações</span><textarea name="notes" rows={3} defaultValue={initial?.notes ?? ""} /></label>
    <ErrorLine message={error} />
    <div className="desktop-actions"><button className="form-submit" style={{ padding: "0 16px" }} disabled={busy}>{busy ? "Salvando…" : initial ? "Salvar alterações" : "Cadastrar processo"}</button>{onCancel && <button type="button" className="filter-button" onClick={onCancel}>Cancelar</button>}</div>
  </form>;
}

function AddDocument({ status, clientId, matterId, clients, onAdded }: { status: Status; clientId?: string; matterId?: string | null; clients?: Client[]; onAdded: () => void }) {
  const { busy, error, setError, run } = useAsync();
  const [client, setClient] = useState(clientId ?? "");
  const [matter, setMatter] = useState<string>(matterId ?? "");
  const [matters, setMatters] = useState<Matter[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [name, setName] = useState("");
  useEffect(() => { setClient(clientId ?? ""); setMatter(matterId ?? ""); }, [clientId, matterId]);
  useEffect(() => { if (client && matterId === undefined) api.listMatters(client, "", false).then(setMatters).catch(() => setMatters([])); }, [client, matterId]);
  if (!status.documents_root) return <div className="mini-empty">Defina a pasta de documentos em Configurações para adicionar arquivos.</div>;
  async function pick() { const p = await run(() => api.pickFile("Escolher documento", false)); if (p) { setSource(p); setError(""); } }
  async function add() {
    if (!source) { setError("Escolha um arquivo."); return; }
    if (!client) { setError("Escolha o cliente."); return; }
    const d = await run(() => api.importDocument(source, client, matter || null, name.trim() || null));
    if (d) { setSource(null); setName(""); onAdded(); }
  }
  return <div className="desktop-form">
    {clients && <label><span>Cliente</span><select value={client} onChange={e => { setClient(e.target.value); setMatter(""); }}><option value="">Selecione</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    {matterId === undefined && client && <label><span>Processo (opcional)</span><select value={matter} onChange={e => setMatter(e.target.value)}><option value="">Sem processo</option>{matters.map(m => <option key={m.id} value={m.id}>{m.number ? m.number + " · " : ""}{m.title}</option>)}</select></label>}
    <label><span>Nome do documento (opcional)</span><input value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Petição inicial" /></label>
    <div className="desktop-actions"><button type="button" className="filter-button" onClick={pick} disabled={busy}><FolderOpen size={15} />Escolher arquivo</button>{source && <span className="desktop-path">{source}</span>}</div>
    <p className="form-hint" style={{ margin: 0, fontSize: 8, color: "#8a929e" }}>Uma cópia é guardada em <span className="desktop-path">{status.documents_root}</span> (cliente/processo). O arquivo original não é alterado. Arquivos que já estão dentro da pasta são apenas registrados.</p>
    <ErrorLine message={error} />
    <div><button type="button" className="form-submit" style={{ padding: "0 16px" }} onClick={add} disabled={busy || !source}>{busy ? "Adicionando…" : "Adicionar documento"}</button></div>
  </div>;
}

function DocList({ docs, showOwner }: { docs: Doc[]; showOwner?: boolean }) {
  const { error, run } = useAsync();
  if (docs.length === 0) return <div className="mini-empty">Nenhum documento.</div>;
  return <>
    <div className="desktop-list">{docs.map(d => <div key={d.id}>
      <div><strong>{d.name}</strong><small>{showOwner ? `${d.client_name}${d.matter_title ? " · " + (d.matter_number ?? d.matter_title) : ""} · ` : ""}{formatBytes(d.size_bytes)} · {formatDate(d.created_at)}</small><small className="desktop-path">{d.relative_path}</small></div>
      <div className="desktop-actions"><button className="filter-button" onClick={() => run(() => api.openDocument(d.id))}><ExternalLink size={14} />Abrir</button><button className="filter-button" onClick={() => run(() => api.revealDocument(d.id))}><FolderOpen size={14} />Mostrar na pasta</button></div>
    </div>)}</div>
    <ErrorLine message={error} />
  </>;
}

// ---------------------------------------------------------------------------

function ClientsView({ status, focus, go, onChange }: { status: Status; focus: string | null; go: GoFn; onChange: () => void }) {
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState<string | null>(focus);
  const [creating, setCreating] = useState(false);
  const { error, run } = useAsync();
  const load = useCallback(() => run(() => api.listClients(query, archived)).then(r => r && setClients(r)), [query, archived, run]);
  useEffect(() => { load(); }, [load]);
  const current = clients.find(c => c.id === selected) ?? null;
  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">Relacionamento</span><h1>Clientes</h1><p>Uma ficha única por pessoa ou empresa, reutilizada em processos e documentos.</p></div><button className="new-button" onClick={() => { setCreating(true); setSelected(null); }}><Plus size={16} />Novo cliente</button></section>
    <div className="toolbar-card"><div className="search-field"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome, CPF, CNPJ ou e-mail" /></div><label className="filter-button"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />Mostrar arquivados</label></div>
    <ErrorLine message={error} />
    <div className="desktop-two">
      <section className="panel">
        {clients.length === 0 ? <div className="empty-state"><Building2 size={28} /><h2>{query ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}</h2><p>Cadastre uma pessoa ou empresa uma única vez.</p></div> :
          <div className="desktop-list">{clients.map(c => <button key={c.id} className={c.id === selected ? "selected" : ""} onClick={() => { setSelected(c.id); setCreating(false); }}>
            <div><strong>{c.name}{c.status === "ARCHIVED" ? " · arquivado" : ""}</strong><small>{c.type === "INDIVIDUAL" ? "Pessoa física" : "Pessoa jurídica"}{c.cpf_cnpj ? " · " + c.cpf_cnpj : ""}</small></div>
            <small>{c.matter_count ?? 0} proc. · {c.document_count ?? 0} docs</small>
          </button>)}</div>}
      </section>
      <div className="page-stack">
        {creating && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">Cadastro</span><h2>Novo cliente</h2></div></div><ClientForm onSaved={c => { setCreating(false); setSelected(c.id); load(); onChange(); }} onCancel={() => setCreating(false)} /></section>}
        {current && !creating && <ClientDetail key={current.id} status={status} client={current} go={go} onChange={() => { load(); onChange(); }} />}
        {!current && !creating && <div className="mini-empty">Selecione um cliente ou cadastre um novo.</div>}
      </div>
    </div>
  </div>;
}

function ClientDetail({ status, client, go, onChange }: { status: Status; client: Client; go: GoFn; onChange: () => void }) {
  const [matters, setMatters] = useState<Matter[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [newMatter, setNewMatter] = useState(false);
  const { error, run } = useAsync();
  const load = useCallback(() => {
    run(() => api.listMatters(client.id, "", true)).then(r => r && setMatters(r));
    run(() => api.listDocuments(client.id, null)).then(r => r && setDocs(r));
  }, [client.id, run]);
  useEffect(() => { load(); }, [load]);
  const archived = client.status === "ARCHIVED";
  return <>
    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">{client.type === "INDIVIDUAL" ? "Pessoa física" : "Pessoa jurídica"}</span><h2>{client.name}</h2></div>
        <button className="filter-button" onClick={async () => { if (await run(() => api.setClientStatus(client.id, archived ? "ACTIVE" : "ARCHIVED"))) onChange(); }}>{archived ? <><ArchiveRestore size={14} />Reativar</> : <><Archive size={14} />Arquivar</>}</button></div>
      <ClientForm initial={client} onSaved={() => onChange()} />
      <ErrorLine message={error} />
    </section>
    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">Processos</span><h2>{matters.length} vinculado(s)</h2></div><button className="filter-button" onClick={() => setNewMatter(v => !v)}><Plus size={14} />Novo processo</button></div>
      {newMatter && <div style={{ marginBottom: 14 }}><MatterForm clients={[]} fixedClient={client.id} onSaved={() => { setNewMatter(false); load(); onChange(); }} onCancel={() => setNewMatter(false)} /></div>}
      {matters.length === 0 ? <div className="mini-empty">Nenhum processo.</div> :
        <div className="desktop-list">{matters.map(m => <button key={m.id} onClick={() => go("matters", { matter: m.id })}><div><strong>{m.title}{m.status === "ARCHIVED" ? " · arquivado" : ""}</strong><small>{m.number ?? "sem número"}{m.court ? " · " + m.court : ""}</small></div><small>{m.document_count ?? 0} docs</small></button>)}</div>}
    </section>
    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">Documentos</span><h2>{docs.length} arquivo(s)</h2></div></div>
      <DocList docs={docs} />
      <div style={{ marginTop: 14 }}><AddDocument status={status} clientId={client.id} onAdded={() => { load(); onChange(); }} /></div>
    </section>
  </>;
}

// ---------------------------------------------------------------------------

function MattersView({ status, focus, go, onChange }: { status: Status; focus: string | null; go: GoFn; onChange: () => void }) {
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState<string | null>(focus);
  const [creating, setCreating] = useState(false);
  const { error, run } = useAsync();
  const load = useCallback(() => {
    run(() => api.listMatters(null, query, archived || Boolean(focus))).then(r => r && setMatters(r));
    run(() => api.listClients("", false)).then(r => r && setClients(r));
  }, [query, archived, focus, run]);
  useEffect(() => { load(); }, [load]);
  const current = matters.find(m => m.id === selected) ?? null;
  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">Contencioso & assuntos</span><h1>Processos</h1><p>Cadastro do processo, vínculo com o cliente e documentos na pasta local.</p></div><button className="new-button" onClick={() => { setCreating(true); setSelected(null); }}><Plus size={16} />Novo processo</button></section>
    <div className="toolbar-card"><div className="search-field"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Número CNJ, título ou cliente" /></div><label className="filter-button"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />Mostrar arquivados</label></div>
    <ErrorLine message={error} />
    <div className="desktop-two">
      <section className="panel">
        {matters.length === 0 ? <div className="empty-state"><BriefcaseBusiness size={28} /><h2>{query ? "Nenhum processo encontrado" : "Nenhum processo cadastrado"}</h2><p>{clients.length ? "Cadastre o primeiro processo." : "Cadastre primeiro um cliente."}</p></div> :
          <div className="desktop-list">{matters.map(m => <button key={m.id} className={m.id === selected ? "selected" : ""} onClick={() => { setSelected(m.id); setCreating(false); }}>
            <div><strong>{m.title}{m.status === "ARCHIVED" ? " · arquivado" : ""}</strong><small>{m.number ?? "sem número"} · {m.client_name}</small></div><small>{m.document_count ?? 0} docs</small>
          </button>)}</div>}
      </section>
      <div className="page-stack">
        {creating && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">Cadastro</span><h2>Novo processo</h2></div></div>{clients.length ? <MatterForm clients={clients} onSaved={m => { setCreating(false); setSelected(m.id); load(); onChange(); }} onCancel={() => setCreating(false)} /> : <div className="mini-empty">Cadastre primeiro um cliente. <button className="ghost-button" onClick={() => go("clients")}>Ir para Clientes</button></div>}</section>}
        {current && !creating && <MatterDetail key={current.id} status={status} matter={current} clients={clients} go={go} onChange={() => { load(); onChange(); }} />}
        {!current && !creating && <div className="mini-empty">Selecione um processo ou cadastre um novo.</div>}
      </div>
    </div>
  </div>;
}

function MatterDetail({ status, matter, clients, go, onChange }: { status: Status; matter: Matter; clients: Client[]; go: GoFn; onChange: () => void }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const { error, run } = useAsync();
  const load = useCallback(() => run(() => api.listDocuments(null, matter.id)).then(r => r && setDocs(r)), [matter.id, run]);
  useEffect(() => { load(); }, [load]);
  const archived = matter.status === "ARCHIVED";
  const options = clients.some(c => c.id === matter.client_id) ? clients : [...clients, { id: matter.client_id, name: matter.client_name ?? matter.client_id } as Client];
  return <>
    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">{matter.number ?? "Processo"}</span><h2>{matter.title}</h2></div>
        <div className="desktop-actions"><button className="filter-button" onClick={() => go("clients", { client: matter.client_id })}><ContactRound size={14} />{matter.client_name}</button>
          <button className="filter-button" onClick={async () => { if (await run(() => api.setMatterStatus(matter.id, archived ? "ACTIVE" : "ARCHIVED"))) onChange(); }}>{archived ? <><ArchiveRestore size={14} />Reativar</> : <><Archive size={14} />Arquivar</>}</button></div></div>
      <MatterForm initial={matter} clients={options} onSaved={() => onChange()} />
      <ErrorLine message={error} />
    </section>
    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">Documentos</span><h2>{docs.length} arquivo(s)</h2></div></div>
      <DocList docs={docs} />
      <div style={{ marginTop: 14 }}><AddDocument status={status} clientId={matter.client_id} matterId={matter.id} onAdded={() => { load(); onChange(); }} /></div>
    </section>
  </>;
}

// ---------------------------------------------------------------------------

function DocumentsView({ status, go, onChange }: { status: Status; go: GoFn; onChange: () => void }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const { error, run } = useAsync();
  const load = useCallback(() => {
    run(() => api.listDocuments(null, null)).then(r => r && setDocs(r));
    run(() => api.listClients("", false)).then(r => r && setClients(r));
  }, [run]);
  useEffect(() => { load(); }, [load]);
  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">Arquivos locais</span><h1>Documentos</h1><p>Os arquivos ficam na pasta escolhida por você; o banco guarda apenas o caminho relativo e o checksum.</p></div></section>
    <DocumentsRootWarning status={status} go={go} />
    <ErrorLine message={error} />
    <div className="desktop-two">
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">Todos</span><h2>{docs.length} documento(s)</h2></div></div><DocList docs={docs} showOwner /></section>
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">Adicionar</span><h2>Novo documento</h2></div></div>{clients.length ? <AddDocument status={status} clients={clients} onAdded={() => { load(); onChange(); }} /> : <div className="mini-empty">Cadastre primeiro um cliente.</div>}</section>
    </div>
  </div>;
}

// ---------------------------------------------------------------------------

function BackupView({ status, onChange }: { status: Status; onChange: () => void }) {
  const [includeDocs, setIncludeDocs] = useState(true);
  const [report, setReport] = useState<BackupReport | null>(null);
  const create = useAsync();
  const [file, setFile] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [restored, setRestored] = useState<RestoreReport | null>(null);
  const restore = useAsync();

  async function doBackup() {
    setReport(null);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const dest = await create.run(() => api.pickBackupDestination(`lawyermind-${stamp}.lawyermind-backup`));
    if (!dest) return;
    const r = await create.run(() => api.createBackup(dest, includeDocs));
    if (r) setReport(r);
  }
  async function chooseBackup() {
    setManifest(null); setRestored(null); setConfirm(false); setTarget(null);
    const p = await restore.run(() => api.pickFile("Escolher backup", true));
    if (!p) return;
    setFile(p);
    const m = await restore.run(() => api.verifyBackup(p));
    if (m) setManifest(m);
  }
  async function chooseTarget() { const p = await restore.run(() => api.pickFolder("Pasta vazia para restaurar os documentos")); if (p) setTarget(p); }
  async function doRestore() {
    if (!file || !manifest) return;
    const r = await restore.run(() => api.restoreBackup(file, manifest.includes_documents ? target : null));
    if (r) { setRestored(r); setConfirm(false); onChange(); }
  }

  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">Proteção dos dados</span><h1>Backup</h1><p>Um único arquivo <b>.lawyermind-backup</b> com o banco e, se marcado, os documentos. Cada backup é relido e verificado por checksum.</p></div></section>
    <Banner><strong>Salve backups fora deste computador</strong> (pen drive, disco externo ou uma pasta sincronizada). Sincronizar o arquivo de backup é seguro; o banco ativo em <span className="desktop-path">{status.database_dir}</span> nunca deve ficar em pasta sincronizada.</Banner>
    <div className="desktop-two">
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Criar</span><h2>Novo backup</h2></div><DatabaseBackup size={16} /></div>
        <div className="desktop-form">
          <label className="check-line"><input type="checkbox" checked={includeDocs} onChange={e => setIncludeDocs(e.target.checked)} />Incluir os documentos (arquivos) no backup</label>
          <p style={{ margin: 0, fontSize: 9, color: "#68707C" }}>{includeDocs ? `Inclui o banco (clientes, processos, metadados) e os ${status.counts?.documents ?? 0} documento(s) da pasta local.` : "Inclui somente o banco. Os arquivos da pasta de documentos NÃO entram neste backup."}</p>
          <ErrorLine message={create.error} />
          <div><button className="form-submit" style={{ padding: "0 16px" }} onClick={doBackup} disabled={create.busy}>{create.busy ? "Gerando e verificando…" : "Salvar backup…"}</button></div>
          {report && <Banner tone="success"><strong>Backup verificado.</strong> {formatBytes(report.bytes)} · {report.counts.clients} cliente(s), {report.counts.matters} processo(s), {report.counts.documents} documento(s) {report.includes_documents ? `(arquivos incluídos, ${formatBytes(report.documents_bytes)})` : "(arquivos NÃO incluídos)"}<br /><span className="desktop-path">{report.path}</span></Banner>}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Restaurar</span><h2>Restaurar backup</h2></div><ArchiveRestore size={16} /></div>
        <div className="desktop-form">
          <p style={{ margin: 0, fontSize: 9, color: "#68707C" }}>Substitui os registros atuais pelos do backup. Antes, um backup de segurança do estado atual é salvo automaticamente. Nenhum arquivo existente é sobrescrito.</p>
          <div><button className="filter-button" onClick={chooseBackup} disabled={restore.busy}><FolderOpen size={14} />Escolher arquivo de backup</button></div>
          {file && <span className="desktop-path">{file}</span>}
          {manifest && <dl className="detail-list">
            <div><dt>Criado em</dt><dd>{formatDate(manifest.created_at)} · v{manifest.app_version}</dd></div>
            <div><dt>Conteúdo</dt><dd>{manifest.counts.clients} cliente(s) · {manifest.counts.matters} processo(s) · {manifest.counts.documents} documento(s)</dd></div>
            <div><dt>Documentos incluídos</dt><dd>{manifest.includes_documents ? `sim (${formatBytes(manifest.documents_bytes)})` : "não — somente banco"}</dd></div>
            <div><dt>Integridade</dt><dd>verificada</dd></div>
          </dl>}
          {manifest?.includes_documents && <div className="desktop-actions"><button className="filter-button" onClick={chooseTarget}><FolderOpen size={14} />Pasta para os documentos</button>{target && <span className="desktop-path">{target}</span>}</div>}
          {manifest && !manifest.includes_documents && <p style={{ margin: 0, fontSize: 9, color: "#9E3F2C" }}>Este backup não contém arquivos: os documentos continuarão sendo procurados na pasta atual.</p>}
          {manifest && <label className="check-line"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />Entendo que os registros atuais serão substituídos pelos do backup</label>}
          <ErrorLine message={restore.error} />
          {manifest && <div><button className="danger-button" onClick={doRestore} disabled={!confirm || restore.busy || (manifest.includes_documents && !target)}>{restore.busy ? "Restaurando…" : "Restaurar"}</button></div>}
          {restored && <Banner tone="success"><strong>Restauração concluída.</strong> {restored.counts.clients} cliente(s), {restored.counts.matters} processo(s), {restored.counts.documents} documento(s). {restored.includes_documents ? `${restored.documents_written} arquivo(s) gravados em ${restored.documents_root}.` : ""}<br />Backup de segurança anterior: <span className="desktop-path">{restored.safety_backup}</span></Banner>}
        </div>
      </section>
    </div>
  </div>;
}

// ---------------------------------------------------------------------------

function SettingsView({ status, onChange }: { status: Status; onChange: () => void }) {
  const [candidate, setCandidate] = useState<string | null>(null);
  const [check, setCheck] = useState<RootCheck | null>(null);
  const [force, setForce] = useState(false);
  const [done, setDone] = useState("");
  const { busy, error, run } = useAsync();
  async function choose() {
    setDone(""); setCheck(null); setForce(false);
    const p = await run(() => api.pickFolder(status.documents_root ? "Nova localização da pasta de documentos" : "Pasta de documentos"));
    if (!p) return;
    setCandidate(p);
    const c = await run(() => api.checkDocumentsRoot(p));
    if (c) setCheck(c);
  }
  async function apply() {
    if (!candidate) return;
    const c = await run(() => api.setDocumentsRoot(candidate, force));
    if (c) { setDone(`Pasta definida: ${c.found} de ${c.total} documento(s) encontrados.`); setCandidate(null); setCheck(null); onChange(); }
  }
  const cur = status.documents_check;
  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">Este computador</span><h1>Configurações</h1><p>Pasta de documentos, local do banco e garantias de funcionamento offline.</p></div></section>
    <div className="desktop-two">
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Documentos</span><h2>Pasta de documentos</h2></div><FolderOpen size={16} /></div>
        <dl className="detail-list">
          <div><dt>Pasta atual</dt><dd className="desktop-path">{status.documents_root ?? "não definida"}</dd></div>
          {cur && <div><dt>Situação</dt><dd>{cur.exists ? `${cur.found} de ${cur.total} documento(s) encontrados` : "pasta inacessível"}</dd></div>}
        </dl>
        <p style={{ fontSize: 9, color: "#68707C" }}>O banco guarda caminhos relativos a esta pasta. Se você mover a pasta, trocar de disco ou restaurar em outro computador, escolha a nova localização: o app confere se os arquivos estão lá antes de aplicar.</p>
        <div className="desktop-form">
          <div><button className="filter-button" onClick={choose} disabled={busy}><FolderOpen size={14} />{status.documents_root ? "Relocalizar pasta…" : "Escolher pasta…"}</button></div>
          {candidate && <span className="desktop-path">{candidate}</span>}
          {check && <Banner tone={check.missing ? "danger" : "success"}>{check.total === 0 ? "Nenhum documento cadastrado ainda." : `${check.found} de ${check.total} documento(s) encontrados nesta pasta.`}{check.missing > 0 && <><br />Ausentes, por exemplo: {check.missing_samples.slice(0, 3).join(", ")}</>}</Banner>}
          {check && check.missing > 0 && <label className="check-line"><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />Usar mesmo assim (os documentos ausentes ficarão indisponíveis)</label>}
          {check && <div><button className="form-submit" style={{ padding: "0 16px" }} onClick={apply} disabled={busy || (check.missing > 0 && !force)}>Usar esta pasta</button></div>}
          <ErrorLine message={error} />
          {done && <Banner tone="success">{done}</Banner>}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Banco local</span><h2>PostgreSQL neste computador</h2></div><HardDrive size={16} /></div>
        <dl className="detail-list">
          <div><dt>Versão</dt><dd>PostgreSQL {status.postgres_version}</dd></div>
          <div><dt>Endereço</dt><dd>127.0.0.1:{status.postgres_port} (sem acesso externo)</dd></div>
          <div><dt>Pasta do banco</dt><dd className="desktop-path">{status.database_dir}</dd></div>
          <div><dt>Esquema</dt><dd>{status.schema_version}</dd></div>
        </dl>
        <Banner tone="danger"><strong>Nunca coloque a pasta do banco no Google Drive, OneDrive, Dropbox ou iCloud.</strong> Sincronizar o banco em uso corrompe os dados. O app se recusa a iniciar se detectar isso. Para cópias, use Backup.</Banner>
        <p style={{ fontSize: 9, color: "#68707C" }}>O LawyerMind Desktop não envia dados pela internet, não usa contas externas e não precisa de servidor.</p>
      </section>
    </div>
  </div>;
}
