"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatResult, Suggestion } from "@/lib/ai/chat";
import type { ProviderStatus } from "@/lib/ai/provider";
import "./assistant.css";

type Window = { offset: number; length: number; text: string; max: number };
type Answer = Extract<ChatResult, { status: "answer" }>;

// Chat about ONE selected excerpt. There is no simulated answer: with no provider the form stays disabled.
export function DocumentAssistant({ documentId, versionId, label }: { documentId: string; versionId: string; label: string }) {
  const [provider, setProvider] = useState<ProviderStatus | null>(null), [win, setWin] = useState<Window | null>(null);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null), [question, setQuestion] = useState(""), [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [answer, setAnswer] = useState<Answer | null>(null);
  const area = useRef<HTMLTextAreaElement>(null), generation = useRef(0);

  const load = async (offset: number) => {
    const id = ++generation.current; setError(""); setSel(null); setAnswer(null);
    try {
      const r = await fetch(`/api/desktop/ai-chat?versionId=${encodeURIComponent(versionId)}&offset=${offset}`, { cache: "no-store" });
      const body = await r.json(); if (!r.ok) throw Error(body.error ?? "Não foi possível ler o texto.");
      if (id === generation.current) { setProvider(body.provider); setWin(body.window); }
    } catch (e) { if (id === generation.current) setError(e instanceof Error ? e.message : "Falha ao carregar."); }
  };
  useEffect(() => { void load(0); return () => { generation.current++; }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [versionId]);

  const available = provider?.state === "available";
  const onSelect = () => { const a = area.current; if (!a || !win) return; setSel(a.selectionEnd > a.selectionStart ? { start: win.offset + a.selectionStart, end: win.offset + a.selectionEnd } : null); };
  const ask = async () => {
    if (!sel || !available || !consent || busy) return;
    const id = ++generation.current; setBusy(true); setError(""); setAnswer(null);
    try {
      const r = await fetch("/api/desktop/ai-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId, start: sel.start, end: sel.end, question, consent: true }) });
      const body = await r.json(); if (!r.ok) throw Error(body.error ?? "Falha na consulta.");
      if (id === generation.current) setAnswer(body);
    } catch (e) { if (id === generation.current) setError(e instanceof Error ? e.message : "Falha na consulta."); }
    finally { if (id === generation.current) setBusy(false); }
  };

  return <section className="doc-ai" aria-labelledby="doc-ai-title">
    <header><span className="eyebrow">Assistente do documento</span><h1 id="doc-ai-title">{label}</h1><a href={`/app/documentos/${documentId}`}>← Voltar ao documento</a></header>
    {provider && <p role="status" className={"doc-ai-provider " + (available ? "ok" : "off")}><strong>{provider.label}</strong> — {provider.reason}</p>}
    {error && <p role="alert" className="doc-ai-error">{error}</p>}
    {win && <>
      <h2>1 · Fonte: selecione o trecho</h2>
      <p className="hint">Somente o trecho selecionado (até {win.max} caracteres) pode ser usado. O original não é alterado.</p>
      <textarea ref={area} readOnly value={win.text} onSelect={onSelect} onKeyUp={onSelect} onMouseUp={onSelect} aria-label="Texto do documento" rows={12} />
      <div className="doc-ai-nav"><button type="button" disabled={win.offset === 0} onClick={() => load(Math.max(0, win.offset - win.max))}>← Trecho anterior</button>
        <span>Caracteres {win.offset}–{Math.min(win.length, win.offset + win.max)} de {win.length}</span>
        <button type="button" disabled={win.offset + win.max >= win.length} onClick={() => load(win.offset + win.max)}>Próximo trecho →</button></div>
      <p>{sel ? `Selecionado: ${sel.end - sel.start} caracteres (${sel.start}–${sel.end})${sel.end - sel.start > win.max ? " — acima do limite" : ""}` : "Nada selecionado."}</p>

      <h2>2 · Pergunta</h2>
      <label>Pergunta sobre o trecho<textarea value={question} maxLength={2000} disabled={!available} onChange={e => setQuestion(e.target.value)} rows={3} /></label>
      <label className="doc-ai-consent"><input type="checkbox" checked={consent} disabled={!available} onChange={e => setConsent(e.target.checked)} />
        {provider?.sendsDataOutsideDevice ? "Autorizo enviar SOMENTE o trecho selecionado e a pergunta ao provedor acima, fora deste computador." : "Autorizo usar o trecho selecionado e a pergunta com o provedor acima."}</label>
      <button type="button" disabled={!available || !sel || sel.end - sel.start > win.max || !question.trim() || !consent || busy} onClick={ask}>{busy ? "Consultando…" : "Perguntar"}</button>
      {!available && <p className="hint">Indisponível de verdade: sem provedor conectado não há resposta, nem simulada.</p>}
    </>}
    {answer && <AnswerView answer={answer} />}
  </section>;
}

function AnswerView({ answer }: { answer: Answer }) {
  const copy = (s: Suggestion) => navigator.clipboard?.writeText(s.replacement ?? s.reason).catch(() => {});
  return <div className="doc-ai-answer" aria-live="polite">
    <p className="doc-ai-notice">{answer.notice}</p>
    <h2>Fonte verificada no trecho</h2>
    {answer.sources.verified.length ? <ul>{answer.sources.verified.map((c, i) => <li key={i}><blockquote>{c.quote}</blockquote><small>caracteres {c.start}–{c.end}</small></li>)}</ul> : <p>Nenhuma citação literal confirmada.</p>}
    {answer.sources.unverifiedCount > 0 && <p>{answer.sources.unverifiedCount} item(ns) do provedor descartado(s) por não constarem literalmente no trecho.</p>}
    <h2>Sugestão da IA · não aplicada</h2>
    <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{answer.suggestion.answer}</p>
    {answer.suggestion.suggestions.map((s, i) => <article key={i} className="doc-ai-suggestion"><strong>{s.kind === "replace" ? "Proposta de substituição" : "Comentário"}</strong>
      <blockquote>{s.quote}</blockquote>{s.replacement && <p><b>Redação proposta:</b> {s.replacement}</p>}<p>{s.reason}</p>
      <small>Âncora: caracteres {s.anchor.start}–{s.anchor.end} · nada foi aplicado</small> <button type="button" onClick={() => copy(s)}>Copiar texto</button></article>)}
    <h2>Incerteza: {{ low: "baixa", medium: "média", high: "alta" }[answer.uncertainty.level]}</h2>
    <ul>{answer.uncertainty.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
  </div>;
}
