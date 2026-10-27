"use client";
import { useEffect, useState } from "react";
import { Plug } from "lucide-react";
import "./desktop.css";

type Token = { id: string; name: string; createdAt: number; expiresAt: number; lastUsedAt: number | null; status: "active" | "expired" | "revoked" };
type State = { enabled: boolean; tokens: Token[]; client: { node: string | null; bridge: string | null; stateDir: string } };

async function call<T>(method: "GET" | "POST", body?: unknown): Promise<T> {
  const r = await fetch("/api/desktop/mcp-settings", { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Falha.");
  return j as T;
}
const fmt = (t: number) => new Date(t).toLocaleDateString("pt-BR");

/** External AI apps (e.g. Claude Desktop) reading documents through the read-only MCP endpoint. Off by default. */
export function McpPanel() {
  const [state, setState] = useState<State | null>(null), [name, setName] = useState("Claude Desktop"), [days, setDays] = useState(90);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const load = () => call<State>("GET").then(setState).catch(e => setMsg({ text: e.message, tone: "warn" }));
  useEffect(() => { void load(); }, []);

  async function act(fn: () => Promise<void>) { setBusy(true); setMsg(null); try { await fn(); await load(); } catch (e) { setMsg({ text: (e as Error).message, tone: "warn" }); } finally { setBusy(false); } }
  if (!state) return msg ? <p className="desktop-note warn">{msg.text}</p> : null;

  const snippet = created ? JSON.stringify({ mcpServers: { lawyermind: {
    command: state.client.node ?? "<caminho do node do LawyerMind>", args: [state.client.bridge ?? "<caminho do mcp-bridge.mjs>"],
    env: { LAWYERMIND_MCP_TOKEN: created.token, LAWYERMIND_STATE_DIR: state.client.stateDir },
  } } }, null, 2) : "";

  return <article className="panel panel-wide">
    <div className="panel-heading"><div><span className="eyebrow">Computador</span><h2><Plug size={16}/> Conectar um aplicativo de IA (MCP)</h2></div></div>
    <p className="desktop-note">Deixe um aplicativo de IA que você já usa (por exemplo, o Claude Desktop) <strong>ler</strong> seus documentos para responder perguntas. É <strong>somente leitura</strong>: nada é alterado, enviado ou apagado por esse caminho. Cada acesso usa as <strong>suas</strong> permissões e fica registrado (sem o conteúdo). O aplicativo de IA receberá os trechos que pedir e os processará segundo os termos dele: confira-os antes. O LawyerMind precisa estar aberto.</p>
    <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={state.enabled} disabled={busy} onChange={e => act(async () => { await call("POST", { action: "enable", enabled: e.target.checked }); })}/><span>Permitir acesso MCP neste computador (só a conta proprietária altera)</span></label>
    {state.enabled && <>
      <div className="desktop-form" style={{ gridTemplateColumns: "2fr 1fr auto", alignItems: "end", marginTop: 10 }}>
        <label><span>Nome do acesso</span><input value={name} maxLength={60} onChange={e => setName(e.target.value)}/></label>
        <label><span>Validade (dias)</span><input type="number" min={1} max={365} value={days} onChange={e => setDays(Number(e.target.value) || 90)}/></label>
        <button className="desktop-secondary" disabled={busy || !name.trim()} onClick={() => act(async () => { const t = await call<{ token: string; name: string }>("POST", { action: "create", name, days }); setCreated(t); })}>Criar acesso</button>
      </div>
      {created && <div className="desktop-note warn" role="status" style={{ marginTop: 10 }}>
        <strong>Copie agora: esta chave não será mostrada de novo.</strong> Cole o bloco abaixo na configuração de servidores MCP do seu aplicativo de IA (no Claude Desktop: Configurações → Desenvolvedor → Editar configuração). Quem tiver este texto lê seus documentos: não o compartilhe.
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", userSelect: "all" }}>{snippet}</pre>
        <button className="desktop-secondary" onClick={() => setCreated(null)}>Já copiei</button>
      </div>}
      <div className="desktop-rows" style={{ marginTop: 10 }}>{state.tokens.length === 0 ? <div className="mini-empty">Nenhum acesso criado.</div> : state.tokens.map(t => <div key={t.id}>
        <div><strong>{t.name}</strong><small>{t.status === "active" ? `válido até ${fmt(t.expiresAt)}` : t.status === "expired" ? "expirado" : "revogado"} · {t.lastUsedAt ? `usado em ${new Date(t.lastUsedAt).toLocaleString("pt-BR")}` : "nunca usado"}</small></div>
        {t.status === "active" && <div className="desktop-actions"><button className="desktop-danger" disabled={busy} onClick={() => act(async () => { await call("POST", { action: "revoke", id: t.id }); })}>Revogar</button></div>}
      </div>)}</div>
    </>}
    {msg && <p className={"desktop-note " + msg.tone} role="status" style={{ marginTop: 12 }}>{msg.text}</p>}
  </article>;
}
