"use client";
import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import "./desktop.css";

type Summary = { configured: false } | { configured: true; kind: "anthropic" | "openai-compatible"; model: string; baseUrl: string | null; keyHint: string | null; readable: boolean };
type Status = { label: string; state: "available" | "unavailable"; reason: string; sendsDataOutsideDevice: boolean };

async function call<T>(method: "GET" | "PUT" | "DELETE", body?: unknown): Promise<T> {
  const r = await fetch("/api/desktop/ai-settings", { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Falha ao salvar.");
  return j as T;
}

/** Owner only. The key is typed here, kept on this computer, and never shown again (only its last 4 characters). */
export function AiProviderPanel() {
  const [data, setData] = useState<{ settings: Summary; provider: Status } | null>(null);
  const [kind, setKind] = useState<"anthropic" | "openai-compatible">("anthropic");
  const [model, setModel] = useState(""), [baseUrl, setBaseUrl] = useState(""), [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ text: string; tone: "ok" | "warn" } | null>(null), [denied, setDenied] = useState(false);
  const load = () => call<{ settings: Summary; provider: Status }>("GET").then(setData).catch(e => { if (/permiss|propriet/i.test(e.message)) setDenied(true); else setMsg({ text: e.message, tone: "warn" }); });
  useEffect(() => { void load(); }, []);
  if (denied) return null;

  async function save() {
    setBusy(true); setMsg(null);
    try { await call("PUT", { kind, model, baseUrl: kind === "openai-compatible" ? baseUrl : undefined, apiKey }); setApiKey(""); setMsg({ text: "Provedor de IA salvo. A IA só recebe o trecho que o usuário escolher e autorizar a cada envio.", tone: "ok" }); await load(); }
    catch (e) { setMsg({ text: (e as Error).message, tone: "warn" }); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setMsg(null);
    try { await call("DELETE"); setMsg({ text: "Chave removida deste computador.", tone: "ok" }); await load(); }
    catch (e) { setMsg({ text: (e as Error).message, tone: "warn" }); } finally { setBusy(false); }
  }
  const s = data?.settings;
  return <article className="panel panel-wide">
    <div className="panel-heading"><div><span className="eyebrow">Computador</span><h2><Bot size={16}/> Inteligência artificial</h2></div></div>
    <p className="desktop-note">A IA vem <strong>desligada</strong>. Para ligar, use a chave de API de uma conta <strong>sua</strong> (o LawyerMind não cria contas nem paga pelo uso). Cada pergunta envia somente o trecho selecionado e exige o seu consentimento naquele envio. Confira no provedor os termos de retenção, treino e uso comercial: o LawyerMind não os verificou.</p>
    {data && <p className={"desktop-note " + (data.provider.state === "available" ? "ok" : "")} role="status">Situação: {data.provider.state === "available" ? `conectada — ${data.provider.label}` : data.provider.reason}</p>}
    {s?.configured && <p className="desktop-note">Chave guardada neste computador {s.keyHint ?? ""} · {s.model}{s.baseUrl ? ` · ${s.baseUrl}` : ""}{!s.readable && " · ilegível: informe de novo"}</p>}
    <div className="desktop-form" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
      <label><span>Tipo</span><select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="anthropic">Claude (Anthropic)</option><option value="openai-compatible">API compatível com OpenAI (inclui modelo local)</option></select></label>
      <label><span>Modelo</span><input value={model} onChange={e => setModel(e.target.value)} placeholder={kind === "anthropic" ? "nome do modelo na sua conta" : "nome do modelo"} autoComplete="off"/></label>
      {kind === "openai-compatible" && <label style={{ gridColumn: "1 / -1" }}><span>Endereço da API (https, ou http://localhost para modelo local)</span><input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://…/v1" autoComplete="off"/></label>}
      <label style={{ gridColumn: "1 / -1" }}><span>Chave de API (fica só neste computador)</span><input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off"/></label>
    </div>
    <div className="desktop-actions" style={{ marginTop: 8 }}>
      <button className="desktop-secondary" onClick={save} disabled={busy || !model.trim() || apiKey.trim().length < 8 || (kind === "openai-compatible" && !baseUrl.trim())}>Salvar</button>
      {s?.configured && <button className="desktop-danger" onClick={remove} disabled={busy}>Remover chave</button>}
    </div>
    {msg && <p className={"desktop-note " + msg.tone} role="status" style={{ marginTop: 12 }}>{msg.text}</p>}
  </article>;
}
