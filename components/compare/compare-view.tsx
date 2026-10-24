"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompareResult, Observation, Row, Source } from "@/lib/compare/compare";
import { comparePath, openInNewWindow } from "@/components/desktop/windows";
import "./compare.css";

type Pane = "ambos" | "esq" | "dir";
type Meta = { versionId: string; documentId: string; documentName: string; version: number; originalName: string | null; fileSha256: string };
type Ok = Extract<CompareResult, { status: "ok" }>;
type Payload = { left: Meta; right: Meta; result: CompareResult; ai: { state: string; label: string; reason: string } };
type Option = { id: string; documentId: string; label: string };
type Msg = { t: "row"; r: number; from: string } | { t: "obs"; id: string; from: string };

const KIND: Record<Observation["kind"], string> = { inserted: "Incluído", deleted: "Excluído", changed: "Alterado", renumbered: "Renumerado", moved: "Movido", "value-changed": "Valor/prazo/data alterado", "value-added": "Incluído (valor/prazo/data)", "value-removed": "Retirado (valor/prazo/data)", ambiguous: "Ambíguo", "cross-reference": "Referência cruzada" };
const ROW_LABEL: Record<Row["kind"], string> = { equal: "", changed: "alterado", deleted: "excluído", inserted: "incluído", renumbered: "renumerado", moved: "movido" };

/** Splits a paragraph at every highlight boundary and tags each piece with the highlights that cover it. */
function pieces(text: string, base: number, marks: { s: number; e: number; cls: string; obs?: string }[]) {
  const cuts = new Set<number>([0, text.length]);
  for (const m of marks) { cuts.add(Math.max(0, Math.min(text.length, m.s - base))); cuts.add(Math.max(0, Math.min(text.length, m.e - base))); }
  const pts = [...cuts].sort((a, b) => a - b), out: { t: string; cls: string[]; obs: string[] }[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1]; if (a === b) continue;
    const on = marks.filter(m => m.s - base <= a && m.e - base >= b);
    out.push({ t: text.slice(a, b), cls: [...new Set(on.map(m => m.cls))], obs: on.flatMap(m => (m.obs ? [m.obs] : [])) });
  }
  return out;
}

export function CompareView({ left, right, pane }: { left?: string; right?: string; pane: Pane }) {
  const [options, setOptions] = useState<Option[]>([]), [pickL, setPickL] = useState(left ?? ""), [pickR, setPickR] = useState(right ?? "");
  const [data, setData] = useState<Payload | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [active, setActive] = useState<string | null>(null), [attentionOnly, setAttentionOnly] = useState(false), [sync, setSync] = useState(false), [note, setNote] = useState("");
  const scroller = useRef<HTMLDivElement>(null), channel = useRef<BroadcastChannel | null>(null), quiet = useRef(0), lastRow = useRef(-1), me = useRef(Math.random().toString(36).slice(2));
  const generation = useRef(0);

  useEffect(() => {
    const c = new AbortController();
    fetch("/api/desktop/compare", { cache: "no-store", signal: c.signal }).then(async r => { if (!r.ok) throw Error((await r.json().catch(() => ({}))).error ?? "Lista indisponível."); setOptions((await r.json()).versions); }).catch(e => { if (!c.signal.aborted) setError(e.message); });
    return () => c.abort();
  }, []);

  useEffect(() => {
    if (!left || !right) { setData(null); return; }
    const id = ++generation.current; setLoading(true); setError(""); setData(null);
    fetch("/api/desktop/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leftVersionId: left, rightVersionId: right }) })
      .then(async r => { const b = await r.json(); if (!r.ok) throw Error(b.error ?? "Falha na comparação."); if (id === generation.current) setData(b); })
      .catch(e => { if (id === generation.current) setError(e instanceof Error ? e.message : "Falha na comparação."); })
      .finally(() => { if (id === generation.current) setLoading(false); });
  }, [left, right]);

  const res: Ok | null = data?.result.status === "ok" ? data.result : null;
  const rowOf = useMemo(() => { const m = new Map<string, number>(); (res?.rows ?? []).forEach((r, i) => { if (r.left !== undefined) m.set(`left:${r.left}`, i); if (r.right !== undefined) m.set(`right:${r.right}`, i); }); return m; }, [res]);
  const marks = useMemo(() => {
    const m = new Map<string, { s: number; e: number; cls: string; obs?: string }[]>(), put = (k: string, v: { s: number; e: number; cls: string; obs?: string }) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);
    (res?.rows ?? []).forEach(r => (r.changes ?? []).forEach(c => { if (c.left && c.left.end > c.left.start && r.left !== undefined) put(`left:${r.left}`, { s: c.left.start, e: c.left.end, cls: "chg" }); if (c.right && c.right.end > c.right.start && r.right !== undefined) put(`right:${r.right}`, { s: c.right.start, e: c.right.end, cls: "chg" }); }));
    (res?.observations ?? []).forEach(o => o.sources.forEach(s => put(`${s.side}:${s.paragraph}`, { s: s.start, e: s.end, cls: `src ${o.severity}${active === o.id ? " active" : ""}`, obs: o.id })));
    return m;
  }, [res, active]);

  // Optional synchronised scrolling / selection between windows of the same comparison (ids and indices only, never text).
  const channelName = left && right ? `lawyermind-compare:${left}:${right}` : null;
  const goRow = useCallback((r: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-row="${r}"]`); if (!el || !scroller.current) return;
    quiet.current = Date.now() + 300; scroller.current.scrollTop = el.offsetTop - scroller.current.offsetTop - 8;
  }, []);
  useEffect(() => {
    if (!channelName || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(channelName); channel.current = ch;
    ch.onmessage = e => { const m = e.data as Msg; if (!sync || m.from === me.current) return; if (m.t === "row") goRow(m.r); else if (m.t === "obs") { setActive(m.id); } };
    return () => { ch.close(); channel.current = null; };
  }, [channelName, sync, goRow]);
  const onScroll = () => {
    if (!sync || !channel.current || Date.now() < quiet.current || !scroller.current) return;
    const top = scroller.current.getBoundingClientRect().top; let first = -1;
    for (const el of scroller.current.querySelectorAll<HTMLElement>("[data-row]")) if (el.getBoundingClientRect().bottom > top + 4) { first = Number(el.dataset.row); break; }
    if (first >= 0 && first !== lastRow.current) { lastRow.current = first; channel.current.postMessage({ t: "row", r: first, from: me.current } satisfies Msg); }
  };
  const focusObs = (o: Observation) => {
    setActive(o.id); if (sync) channel.current?.postMessage({ t: "obs", id: o.id, from: me.current } satisfies Msg);
    const s = o.sources[0]; const r = rowOf.get(`${s.side}:${s.paragraph}`); if (r !== undefined) goRow(r);
  };
  useEffect(() => { if (!active) return; const o = res?.observations.find(x => x.id === active); const r = o ? rowOf.get(`${o.sources[0].side}:${o.sources[0].paragraph}`) : undefined; if (r !== undefined) goRow(r); }, [active, res, rowOf, goRow]);

  const openWin = async (p: Pane) => { setNote(""); try { await openInNewWindow(comparePath(left!, right!, p)); } catch (e) { setNote(e instanceof Error ? e.message : "Não foi possível abrir a janela."); } };
  const openBoth = async () => { await openWin("esq"); await openWin("dir"); };

  const picker = <form className="cmp-picker" onSubmit={e => { e.preventDefault(); if (pickL && pickR) window.location.assign(comparePath(pickL, pickR, pane)); }}>
    <label><span>Versão da esquerda</span><select value={pickL} onChange={e => setPickL(e.target.value)}><option value="">Escolher…</option>{options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
    <label><span>Versão da direita</span><select value={pickR} onChange={e => setPickR(e.target.value)}><option value="">Escolher…</option>{options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
    <button type="submit" className="desktop-primary" disabled={!pickL || !pickR}>Comparar</button>
  </form>;

  const sides: ("left" | "right")[] = pane === "esq" ? ["left"] : pane === "dir" ? ["right"] : ["left", "right"];
  const obs = (res?.observations ?? []).filter(o => !attentionOnly || o.severity === "attention");
  const metaOf = (s: "left" | "right") => (s === "left" ? data!.left : data!.right);

  return <section className="cmp" aria-labelledby="cmp-title">
    <header><span className="eyebrow">Comparação local</span><h1 id="cmp-title">Comparar versões lado a lado</h1>
      <p className="cmp-safe">Comparação textual determinística, feita neste computador. Nada é enviado a IA ou à internet e nada é alterado nos documentos: as observações só indicam o que conferir.</p></header>
    {picker}
    {error && <p role="alert" className="cmp-error">{error}</p>}
    {loading && <p role="status">Comparando…</p>}
    {data && data.result.status !== "ok" && <p role="alert" className="cmp-error">{data.result.message}</p>}
    {data && res && <>
      <div className="cmp-meta">{(["left", "right"] as const).map(s => <div key={s}><strong>{s === "left" ? "Esquerda" : "Direita"}: {metaOf(s).documentName} · versão {metaOf(s).version}</strong><small>{metaOf(s).originalName ?? "arquivo"} · SHA-256 do arquivo {metaOf(s).fileSha256.slice(0, 16)}…</small></div>)}</div>
      <div className="cmp-bar">
        <span>{res.stats.changed} alterados · {res.stats.inserted} incluídos · {res.stats.deleted} excluídos · {res.stats.renumbered} renumerados · {res.stats.moved} movidos</span>
        <label><input type="checkbox" checked={attentionOnly} onChange={e => setAttentionOnly(e.target.checked)} /> Só o que pede conferência</label>
        <label title="Opcional. Funciona entre janelas abertas desta mesma comparação."><input type="checkbox" checked={sync} onChange={e => setSync(e.target.checked)} /> Rolagem sincronizada</label>
        {pane === "ambos" && <><button type="button" onClick={() => openWin("esq")}>Esquerda em outra janela</button><button type="button" onClick={() => openWin("dir")}>Direita em outra janela</button><button type="button" onClick={openBoth}>Abrir em duas janelas</button></>}
        {note && <span role="alert" className="cmp-error">{note}</span>}
      </div>
      {res.notes.map((n, i) => <p key={i} className="hint">{n}</p>)}
      <div className="cmp-grid">
        <div className="cmp-scroll" ref={scroller} onScroll={onScroll} tabIndex={0} aria-label="Textos comparados">
          {res.rows.map((row, i) => <div key={i} data-row={i} className={`cmp-row k-${row.kind}`} style={{ gridTemplateColumns: `repeat(${sides.length}, minmax(0,1fr))` }}>
            {sides.map(side => {
              const idx = side === "left" ? row.left : row.right, p = idx === undefined ? null : (side === "left" ? res.left : res.right).paragraphs[idx];
              return <div key={side} className={`cmp-cell ${p ? "" : "empty"}`} aria-label={p ? `${side === "left" ? "Esquerda" : "Direita"}, parágrafo ${idx! + 1}${ROW_LABEL[row.kind] ? ", " + ROW_LABEL[row.kind] : ""}` : "Sem texto correspondente neste lado"}>
                {p ? <>{p.page !== null && <small className="cmp-page">p. {p.page}</small>}
                  <p>{pieces(p.text, p.start, marks.get(`${side}:${idx}`) ?? []).map((pc, k) => pc.cls.length ? <mark key={k} className={pc.cls.join(" ")} onClick={() => pc.obs[0] && setActive(pc.obs[0])}>{pc.t}</mark> : <span key={k}>{pc.t}</span>)}</p></> : <small>— sem trecho correspondente —</small>}
              </div>;
            })}
          </div>)}
        </div>
        <aside className="cmp-obs" aria-label="Observações">
          <h2>Observações ({obs.length}{res.truncated ? "+" : ""})</h2>
          {obs.length === 0 && <p>Nenhuma diferença relevante encontrada no texto extraído.</p>}
          <ol>{obs.map(o => <li key={o.id} className={`${o.severity} ${active === o.id ? "active" : ""}`}>
            <button type="button" className="cmp-obs-btn" aria-pressed={active === o.id} onClick={() => focusObs(o)}><strong>{KIND[o.kind]}</strong> {o.title}</button>
            {active === o.id && <div className="cmp-obs-detail">
              {o.sources.map((s: Source, k) => <blockquote key={k}><small>{s.side === "left" ? "Esquerda" : "Direita"}{s.page !== null ? `, página ${s.page}` : ""}, parágrafo {s.paragraph + 1}, caracteres {s.start}–{s.end}{s.clipped ? " (trecho encurtado)" : ""}</small><br />{s.quote}</blockquote>)}
              {o.detail && <p>{o.detail}</p>}
              <p className="cmp-check"><strong>O que conferir:</strong> {o.check}</p>
            </div>}
          </li>)}</ol>
        </aside>
      </div>
      <p className="hint">Resumo por IA: {data.ai.state === "available" ? "provedor configurado, mas nenhuma chamada é feita aqui." : `indisponível (${data.ai.reason})`}</p>
    </>}
  </section>;
}
