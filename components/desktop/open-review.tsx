"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileCheck2, ShieldAlert } from "lucide-react";
import { postJson } from "./native";
import { drainPendingOpens, forgetOpen, listenForOpens } from "./open-client";
import "./desktop.css";

type Finding = { severity: "block" | "warn"; code: string; message: string };
type Assessment = { input: string; ok: boolean; kind: "pdf" | "docx" | null; path: string | null; name: string; size: number; sha256: string | null; findings: Finding[] };
type Item = { input: string; state: "checking" | "ready" | "importing" | "done"; assessment?: Assessment; error?: string; documentId?: string; label: string };
type Option = { id: string; label: string };

const mib = (n: number) => n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Review of files the OS asked LawyerMind to open: checked first, imported as a COPY only after a click. */
export function OpenReview({ clients, matters }: { clients: Option[]; matters: Option[] }) {
  const [items, setItems] = useState<Item[]>([]);
  const [clientId, setClientId] = useState(""), [matterId, setMatterId] = useState("");
  const known = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const paths = (await drainPendingOpens()).filter(p => !known.current.has(p));
    if (!paths.length) return;
    paths.forEach(p => known.current.add(p));
    setItems(prev => [...prev, ...paths.map(p => ({ input: p, state: "checking" as const, label: baseName(p) }))]);
    try {
      const { results } = await postJson<{ results: Assessment[] }>("/api/desktop/open-files", { action: "assess", paths });
      setItems(prev => prev.map(it => { const a = results.find(r => r.input === it.input); return a && it.state === "checking" ? { ...it, state: "ready", assessment: a } : it; }));
    } catch (e) { setItems(prev => prev.map(it => paths.includes(it.input) && it.state === "checking" ? { ...it, state: "ready", error: (e as Error).message } : it)); }
  }, []);

  useEffect(() => { void refresh(); return listenForOpens(() => void refresh()); }, [refresh]);

  const dismiss = (input: string) => { forgetOpen(input); known.current.delete(input); setItems(prev => prev.filter(i => i.input !== input)); };
  const patch = (input: string, over: Partial<Item>) => setItems(prev => prev.map(i => i.input === input ? { ...i, ...over } : i));
  const importOne = async (it: Item, name: string) => {
    const a = it.assessment; if (!a?.ok || !a.path || !a.sha256) return;
    patch(it.input, { state: "importing", error: undefined });
    try {
      const r = await postJson<{ documentId: string }>("/api/desktop/open-files", { action: "import", confirm: true, path: a.path, sha256: a.sha256, clientId: clientId || null, matterId: matterId || null, name: name || null });
      forgetOpen(it.input);
      patch(it.input, { state: "done", documentId: r.documentId });
    } catch (e) { patch(it.input, { state: "ready", error: (e as Error).message }); }
  };

  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">Computador</span><h1>Arquivos recebidos do sistema</h1>
      <p>Você abriu estes arquivos com o LawyerMind. Nada é importado até você confirmar.</p></div></section>
    <p className="desktop-note">O arquivo original <strong>não é alterado, movido nem apagado</strong>: o LawyerMind guarda uma cópia neste computador. Nada é enviado à internet nem a qualquer serviço de IA, e nenhuma macro ou ação do arquivo é executada.</p>
    {items.length === 0 && <div className="empty-state"><FileCheck2 size={28}/><h2>Nenhum arquivo aguardando</h2><p>Use "Abrir com" no Explorer ou no Finder, ou arraste um PDF ou DOCX para o ícone do LawyerMind.</p></div>}
    {items.length > 0 && <div className="desktop-form" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
      <label><span>Cliente (opcional, para os arquivos abaixo)</span><select value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Sem cliente</option>{clients.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label><span>Processo (opcional)</span><select value={matterId} onChange={e => setMatterId(e.target.value)}><option value="">Sem processo</option>{matters.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    </div>}
    {items.map(it => <ReviewCard key={it.input} item={it} onImport={importOne} onDismiss={dismiss} />)}
  </div>;
}

function ReviewCard({ item, onImport, onDismiss }: { item: Item; onImport: (it: Item, name: string) => void; onDismiss: (input: string) => void }) {
  const a = item.assessment, blocked = !a?.ok;
  const [name, setName] = useState(item.label.replace(/\.(pdf|docx)$/i, ""));
  return <article className="panel" aria-label={item.label}>
    <div className="panel-heading"><div><span className="eyebrow">{a?.kind === "pdf" ? "PDF" : a?.kind === "docx" ? "DOCX" : "Arquivo"}</span><h2 style={{ overflowWrap: "anywhere" }}>{item.label}</h2></div>{blocked && item.state === "ready" && <ShieldAlert size={18}/>}</div>
    {item.state === "checking" && <p role="status">Verificando o arquivo…</p>}
    {a && <>
      <p className="desktop-path" style={{ overflowWrap: "anywhere" }}>{a.path ?? a.input}</p>
      {a.size > 0 && <p>{mib(a.size)}{a.sha256 && <> · SHA-256 <span className="desktop-path" title={a.sha256}>{a.sha256.slice(0, 16)}…</span></>}</p>}
      {a.findings.filter(f => f.code !== "scan-note").map(f => <p key={f.code} className={"desktop-note " + (f.severity === "block" ? "warn" : "")} role={f.severity === "block" ? "alert" : "status"}>{f.severity === "block" ? "Bloqueado: " : "Atenção: "}{f.message}</p>)}
      {a.findings.some(f => f.code === "scan-note") && <p className="hint">{a.findings.find(f => f.code === "scan-note")!.message}</p>}
    </>}
    {item.error && <p className="desktop-note warn" role="alert">{item.error}</p>}
    {item.state === "done" && <p className="desktop-note ok" role="status">Cópia importada. O original continua intacto. <a href={"/app/documentos/" + item.documentId}>Abrir o documento</a></p>}
    {item.state !== "done" && <div className="desktop-actions">
      {a?.ok && <label><span>Nome no LawyerMind</span><input value={name} maxLength={200} onChange={e => setName(e.target.value)} /></label>}
      <button className="desktop-primary" disabled={blocked || item.state !== "ready"} onClick={() => onImport(item, name)}>{item.state === "importing" ? "Importando…" : "Importar uma cópia"}</button>
      <button className="desktop-secondary" disabled={item.state === "importing"} onClick={() => onDismiss(item.input)}>Descartar</button>
    </div>}
  </article>;
}
