"use client";
import { useState } from "react";
import { fixtures } from "@/lib/document-review/fixtures";
import { beginReview, decide, opinion, sha256, simulateProposal, snapshot, type Review, type Snapshot } from "@/lib/document-review/model";
import styles from "./pilot.module.css";

export function ReviewPilot() {
  const [fixtureId, setFixtureId] = useState(fixtures[0].id);
  const [party, setParty] = useState(""); const [objective, setObjective] = useState("");
  const [consent, setConsent] = useState(false); const [review, setReview] = useState<Review | null>(null);
  const [reviewId, setReviewId] = useState(""); const [selected, setSelected] = useState("clausula-2");
  const [question, setQuestion] = useState(""); const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Snapshot[]>([]); const [showOpinion, setShowOpinion] = useState(false);
  const fixture = fixtures.find(f => f.id === fixtureId)!;
  async function run(fn: () => Promise<void>) {
    if (busy) return; setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível concluir."); }
    finally { setBusy(false); }
  }
  async function open() {
    await run(async () => {
      if (review && !window.confirm("Encerrar esta revisão? Decisões ainda não salvas serão descartadas.")) return;
      const response = await fetch(fixture.file, { cache: "no-store" });
      if (!response.ok) throw Error("Não foi possível abrir o contrato fictício.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (await sha256(bytes) !== fixture.fileSha256) throw Error("Conflito: o arquivo original não corresponde ao hash esperado.");
      const next = await beginReview(fixture, party, objective, consent);
      setReview(next); setReviewId(crypto.randomUUID()); setMessages([]); setSaved([]); setShowOpinion(false);
    });
  }
  async function propose() {
    await run(async () => {
      if (!review || !consent) throw Error("Confirme o consentimento para continuar a simulação.");
      const p = await simulateProposal(review, selected, question);
      setReview({ ...review, proposals: [...review.proposals, p] });
      setMessages(previous => [...previous, `Você · ${selected}: ${question}`, `Resposta simulada · ${selected}: ${p.reason}`]); setQuestion("");
    });
  }
  async function save() {
    await run(async () => {
      if (!review || !consent) throw Error("Confirme o consentimento local antes de salvar.");
      const value = await snapshot(review);
      const response = await fetch("/api/desktop/review-pilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", consent: true, reviewId, snapshot: value }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error ?? "Falha ao salvar.");
      if (result.snapshotSha256 !== value.sha256) throw Error("Hash de confirmação divergente.");
      setSaved(previous => [...previous, value]); setReview({ ...review, parentSha256: value.sha256 });
    });
  }
  return <div className={styles.pilot}>
    <header><span className="eyebrow">LawyerMind · revisão na mesma tela</span><h1>Documento, conversa e propostas</h1><p className={styles.notice}>PILOTO SIMULADO — somente três contratos fictícios. As respostas são predefinidas; não há revisão por IA real.</p></header>
    <div className={styles.status}><strong>ChatGPT / OpenClaw local: desconectado</strong><span>Nenhum envio externo. Conexão real depende de validação e aprovação separadas; assinatura não significa API gratuita.</span><button disabled>Conectar provedor · bloqueado</button></div>
    <section className={styles.setup} aria-label="Contexto da revisão">
      <label>Contrato fictício<select value={fixtureId} disabled={busy} onChange={e => setFixtureId(e.target.value)}>{fixtures.map(f => <option key={f.id} value={f.id}>{f.name} · {f.format}</option>)}</select></label>
      <label>Parte que você representa<input disabled={Boolean(review)} value={party} maxLength={200} onChange={e => setParty(e.target.value)} placeholder="Ex.: contratada fictícia" /></label>
      <label>Objetivo da revisão<textarea disabled={Boolean(review)} value={objective} maxLength={2000} onChange={e => setObjective(e.target.value)} placeholder="Ex.: negociar aviso de rescisão e pagamento do trabalho concluído" /></label>
      <label className={styles.consent}><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />Autorizo a simulação e o salvamento local com este contrato fictício.</label>
      <button disabled={busy || !party.trim() || !objective.trim() || !consent} onClick={open}>Abrir {fixture.format} e iniciar revisão</button>
      <button disabled title="Importação arbitrária depende da validação do editor e da fidelidade">Abrir documento próprio · ainda bloqueado</button>
    </section>
    {review && <button disabled={busy} onClick={() => { if (window.confirm("Encerrar revisão e descartar decisões não salvas?")) { setReview(null); setMessages([]); setSaved([]); } }}>Encerrar revisão e definir novo contexto</button>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {review && <>
      <div className={styles.context}><strong>{review.fixture.name}</strong><span>Parte: {review.party} · Objetivo: {review.objective}</span><small>SHA-256 original: {review.fixture.fileSha256}</small></div>
      <div className={styles.workspace}>
        <section className={styles.document} aria-label="Documento e cláusulas">
          <h2>Documento aberto</h2><p>Prévia textual do contrato fictício; fidelidade visual de Word ainda não validada. O original permanece somente leitura.</p>
          {review.fixture.format === "PDF" && <details><summary>Ver PDF original nesta tela · somente leitura</summary><iframe title="PDF fictício original" src={review.fixture.file} sandbox="" className={styles.pdf} /><p>A prévia usa o leitor do navegador. PDF.js e seleção visual por página ainda não integrados.</p></details>}
          <h3>Selecione uma cláusula de origem</h3>
          {review.fixture.clauses.map(c => <button key={c.id} className={selected === c.id ? styles.selectedClause : styles.clause} onClick={() => setSelected(c.id)}>{c.text}</button>)}
          <h3>Versão de trabalho</h3><pre className={styles.working}>{review.text}</pre>
          <small>Hash do texto de trabalho: {review.textSha256}</small>
        </section>
        <section className={styles.conversation} aria-label="Conversa e propostas ancoradas">
          <h2>Conversar sobre {selected}</h2><p>Cada proposta aponta para um trecho exato e para o hash da versão. Este piloto tem uma proposta predefinida na cláusula 2.</p>
          <div className={styles.messages} aria-live="polite">{messages.length ? messages.map((m, i) => <p key={i}>{m}</p>) : <p>Escreva sua pergunta para testar o fluxo, sem sair do documento.</p>}</div>
          <label>Pergunta<textarea maxLength={2000} value={question} onChange={e => setQuestion(e.target.value)} /></label>
          <button disabled={busy || !consent || !question.trim() || selected !== "clausula-2" || review.proposals.length >= 32} onClick={propose}>Gerar proposta simulada</button>
          {review.proposals.map(p => <article key={p.id} className={styles.proposal}>
            <strong>{p.anchor.clauseId} · {p.status === "pending" ? "pendente" : p.status === "accepted" ? "aceita" : p.status === "rejected" ? "rejeitada" : "conflito"}</strong>
            <blockquote>{p.anchor.quote}</blockquote><p><b>Redação proposta:</b> {p.replacement}</p><small>Âncora exata: caracteres {p.anchor.start}–{p.anchor.end} · hash {p.anchor.textSha256}</small>
            {p.status === "pending" && <div><button disabled={busy} onClick={() => run(async () => setReview(await decide(review, p.id, "accepted")))}>Aceitar proposta</button><button disabled={busy} onClick={() => run(async () => setReview(await decide(review, p.id, "rejected")))}>Rejeitar</button></div>}
            {p.status === "conflict" && <><p role="alert">A versão mudou. Esta proposta não pode ser aplicada automaticamente.</p><button disabled={busy} onClick={() => setReview({ ...review, proposals: review.proposals.map(x => x.id === p.id ? { ...x, status: "rejected" } : x) })}>Descartar proposta em conflito</button></>}
          </article>)}
        </section>
      </div>
      <section className={styles.finish}><button onClick={() => setShowOpinion(true)}>Gerar parecer simulado</button><button disabled={busy || !consent || review.proposals.some(p => p.status === "pending" || p.status === "conflict")} onClick={save}>Salvar nova versão imutável da revisão</button>
        <p>Salva um snapshot JSON com texto, decisões, parecer e hashes. Não altera o DOCX/PDF original nem gera um DOCX com fidelidade de Word.</p>
        {showOpinion && <pre className={styles.working}>{opinion(review)}</pre>}
        <h3>Versões salvas nesta sessão</h3>{saved.map((s, i) => <p key={i}>Versão {i + 1} · SHA-256 {s.sha256}<br /><small>Original preservado · snapshot local confirmado. Histórico após reabrir ainda pendente.</small></p>)}
      </section>
    </>}
  </div>;
}
