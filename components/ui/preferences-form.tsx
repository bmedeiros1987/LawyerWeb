"use client";
import { useRef, useState } from "react";
import { createLatestWriter } from "@/lib/ui/latest-writer";
import type { DisplayPreferences } from "@/lib/ui/preferences";
import { DEFAULT_PREFERENCES } from "@/lib/ui/preferences-defaults";

const SIZES = [[100, "Padrão (100%)"], [115, "Grande (115%)"], [130, "Muito grande (130%)"], [150, "Máximo (150%)"]] as const;
const DENSITY = [["comfortable", "Confortável"], ["compact", "Compacta"]] as const;
const THEME = [["system", "Igual ao sistema"], ["light", "Claro"], ["dark", "Escuro"]] as const;

type Op = { prefs: DisplayPreferences; reset: boolean };

async function send({ prefs, reset }: Op): Promise<DisplayPreferences> {
  const r = await fetch("/api/preferences", { method: reset ? "DELETE" : "PUT", headers: { "content-type": "application/json" }, body: reset ? undefined : JSON.stringify(prefs) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `Erro ${r.status}`);
  return body as DisplayPreferences;
}

/**
 * Applies the change at once on the page and saves it to the account. Fast
 * clicks build on the latest choice (not on a stale render) and are saved in
 * order, so the last choice is the one stored; see lib/ui/latest-writer.ts.
 */
export function PreferencesForm({ initial }: { initial: DisplayPreferences }) {
  const [prefs, setPrefs] = useState(initial);
  const [status, setStatus] = useState<{ text: string; tone: "ok" | "warn" | "" }>({ text: "", tone: "" });
  const desired = useRef(initial);
  const writer = useRef<ReturnType<typeof createLatestWriter<Op, DisplayPreferences>>>(null);
  writer.current ??= createLatestWriter<Op, DisplayPreferences>(send, initial);

  function apply(p: DisplayPreferences) {
    const root = document.querySelector<HTMLElement>(".app-root");
    if (!root) return;
    root.dataset.theme = p.theme; root.dataset.density = p.density; root.style.setProperty("--fs", String(p.fontScale / 100));
  }
  function show(p: DisplayPreferences) { desired.current = p; setPrefs(p); apply(p); }

  async function save(next: DisplayPreferences, reset = false) {
    show(next); setStatus({ text: "Salvando…", tone: "" });
    const outcome = await writer.current!.write({ prefs: next, reset });
    if (outcome.status === "superseded") return; // a newer choice is on its way
    if (outcome.status === "saved") {
      show(outcome.value);
      setStatus({ text: reset ? "Preferências restauradas para o padrão." : "Salvo. Vale para esta conta em todas as telas e após reiniciar.", tone: "ok" });
    } else {
      show(outcome.confirmed);
      setStatus({ text: `Não foi possível salvar: ${outcome.error.message}. A tela voltou à última configuração salva.`, tone: "warn" });
    }
  }
  const set = <K extends keyof DisplayPreferences>(k: K, v: DisplayPreferences[K]) => save({ ...desired.current, [k]: v });

  return <form className="prefs-form" onSubmit={e => e.preventDefault()}>
    <fieldset><legend>Tamanho do texto</legend>
      <div className="prefs-options">{SIZES.map(([v, label]) => <label key={v}><input type="radio" name="fontScale" checked={prefs.fontScale === v} onChange={() => set("fontScale", v)}/>{label}</label>)}</div>
      <p className="hint">Muda o texto de todas as telas. O zoom do sistema (Ctrl/⌘ e +) continua funcionando junto.</p>
    </fieldset>
    <fieldset><legend>Densidade</legend>
      <div className="prefs-options">{DENSITY.map(([v, label]) => <label key={v}><input type="radio" name="density" checked={prefs.density === v} onChange={() => set("density", v)}/>{label}</label>)}</div>
      <p className="hint">Compacta mostra mais linhas por tela; confortável deixa mais espaço entre elas.</p>
    </fieldset>
    <fieldset><legend>Tema</legend>
      <div className="prefs-options">{THEME.map(([v, label]) => <label key={v}><input type="radio" name="theme" checked={prefs.theme === v} onChange={() => set("theme", v)}/>{label}</label>)}</div>
    </fieldset>
    <div className="prefs-sample" aria-label="Exemplo"><strong>Exemplo de leitura</strong><p>CLÁUSULA 7 – DA MULTA. Em caso de rescisão antecipada, a multa será de 20% do valor remanescente do contrato.</p></div>
    <div className="prefs-actions">
      <button type="button" className="filter-button" onClick={() => save(DEFAULT_PREFERENCES, true)}>Restaurar padrão</button>
      <span role="status" className={"desktop-note " + status.tone}>{status.text}</span>
    </div>
  </form>;
}
