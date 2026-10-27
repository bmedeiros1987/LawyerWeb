"use client";
import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import "./desktop.css";

type Summary = { configured: false } | { configured: true; kind: "anthropic" | "openai-compatible"; model: string; baseUrl: string | null; freeTier: boolean; keyHint: string | null; readable: boolean };

type Preset = { id: string; label: string; kind: "anthropic" | "openai-compatible"; baseUrl: string; free: boolean; note: string };
// Ready-made endpoints. Model names are NOT preset (they change): use the one shown in your provider's console.
const PRESETS: Preset[] = [
  { id: "anthropic", label: "Claude (Anthropic) — pago", kind: "anthropic", baseUrl: "", free: false, note: "Chave criada em console.anthropic.com (com crédito)." },
  { id: "groq", label: "Groq — plano gratuito na nuvem", kind: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", free: true, note: "Crie a chave na sua conta Groq. O plano gratuito tem limite de uso por minuto e por dia (erro 429 ao exceder, sem cobrança). Termos de dados: não verificados por nós." },
  { id: "gemini", label: "Google Gemini — plano gratuito na nuvem", kind: "openai-compatible", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", free: true, note: "Chave do Google AI Studio. No plano gratuito o Google pode usar o conteúdo para melhorar seus produtos. Se der erro 404, confira o endereço de compatibilidade OpenAI na documentação do Google." },
  { id: "local", label: "Modelo local (Ollama) — gratuito, não sai do computador", kind: "openai-compatible", baseUrl: "http://localhost:11434/v1", free: false, note: "Exige o Ollama instalado e um modelo baixado. A chave pode ser qualquer texto de 8+ caracteres (ex.: ollama-local)." },
  { id: "other", label: "Outro (compatível com OpenAI)", kind: "openai-compatible", baseUrl: "", free: false, note: "" },
];
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
  const [preset, setPreset] = useState("anthropic"), [freeTier, setFreeTier] = useState(false);
  const [kind, setKind] = useState<"anthropic" | "openai-compatible">("anthropic");
  const [model, setModel] = useState(""), [baseUrl, setBaseUrl] = useState(""), [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ text: string; tone: "ok" | "warn" } | null>(null), [denied, setDenied] = useState(false);
  const load = () => call<{ settings: Summary; provider: Status }>("GET").then(setData).catch(e => { if (/permiss|propriet/i.test(e.message)) setDenied(true); else setMsg({ text: e.message, tone: "warn" }); });
  useEffect(() => { void load(); }, []);
  if (denied) return null;

  async function save() {
    setBusy(true); setMsg(null);
    try { await call("PUT", { kind, model, baseUrl: kind === "openai-compatible" ? baseUrl : undefined, freeTier, apiKey }); setApiKey(""); setMsg({ text: "Provedor de IA salvo. A IA só recebe o trecho que o usuário escolher e autorizar a cada envio.", tone: "ok" }); await load(); }
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
    {s?.configured && <p className="desktop-note">Chave guardada neste computador {s.keyHint ?? ""} · {s.model}{s.baseUrl ? ` · ${s.baseUrl}` : ""}{s.freeTier ? " · plano gratuito" : ""}{!s.readable && " · ilegível: informe de novo"}</p>}
    <div className="desktop-form" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
      <label style={{ gridColumn: "1 / -1" }}><span>Provedor</span><select value={preset} onChange={e => { const p = PRESETS.find(x => x.id === e.target.value)!; setPreset(p.id); setKind(p.kind); setBaseUrl(p.baseUrl); setFreeTier(p.free); }}>{PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      {PRESETS.find(x => x.id === preset)?.note && <p className="desktop-note" style={{ gridColumn: "1 / -1" }}>{PRESETS.find(x => x.id === preset)?.note}</p>}
      <label><span>Modelo</span><input value={model} onChange={e => setModel(e.target.value)} placeholder={kind === "anthropic" ? "nome do modelo na sua conta" : "nome do modelo"} autoComplete="off"/></label>
      {kind === "openai-compatible" && <label style={{ gridColumn: "1 / -1" }}><span>Endereço da API (https, ou http://localhost para modelo local)</span><input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://…/v1" autoComplete="off"/></label>}
      <label style={{ gridColumn: "1 / -1" }}><span>Chave de API (fica só neste computador)</span><input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off"/></label>
    </div>
    <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}><input type="checkbox" checked={freeTier} onChange={e => setFreeTier(e.target.checked)}/><span>Este é um plano <strong>gratuito</strong> (a cada pergunta, o usuário terá de confirmar que o trecho não tem dados de clientes ou sigilosos)</span></label>
    <div className="desktop-actions" style={{ marginTop: 8 }}>
      <button className="desktop-secondary" onClick={save} disabled={busy || !model.trim() || apiKey.trim().length < 8 || (kind === "openai-compatible" && !baseUrl.trim())}>Salvar</button>
      {s?.configured && <button className="desktop-danger" onClick={remove} disabled={busy}>Remover chave</button>}
    </div>
    {msg && <p className={"desktop-note " + msg.tone} role="status" style={{ marginTop: 12 }}>{msg.text}</p>}
  </article>;
}
