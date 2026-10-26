"use client";
import { useEffect, useState } from "react";
import { postJson } from "./native";
import "./desktop.css";

type Info = { platform: "windows" | "macos" | "linux"; canOpenSystemSettings: boolean; steps: string[]; legacyDocNote: string };

// Informational only: the choice is made by the user in the operating system's own screen.
export function DefaultAppsPanel() {
  const [info, setInfo] = useState<Info | null>(null), [error, setError] = useState(""), [note, setNote] = useState("");
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/desktop/default-apps", { signal: c.signal, cache: "no-store" }).then(async r => { if (!r.ok) throw Error("Indisponível."); setInfo(await r.json()); }).catch(e => { if (!c.signal.aborted) setError(e.message); });
    return () => c.abort();
  }, []);
  const open = async () => { setNote(""); try { const r = await postJson<{ opened: boolean }>("/api/desktop/default-apps", { action: "open-system-settings" }); setNote(r.opened ? "Tela do Windows aberta." : "Não foi possível abrir a tela do sistema."); } catch (e) { setNote((e as Error).message); } };
  return <section className="prefs-form" aria-labelledby="default-apps-title">
    <h2 id="default-apps-title">Aplicativo padrão para PDF e DOCX</h2>
    <p>O LawyerMind se oferece como opção em "Abrir com" para PDF e DOCX, mas <strong>nunca se torna o padrão sozinho</strong>. Se quiser, escolha você mesmo pelo fluxo do seu sistema:</p>
    {error && <p role="alert" className="desktop-note warn">{error}</p>}
    {info && <>
      <ol>{info.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      {info.canOpenSystemSettings && <button type="button" className="filter-button" onClick={open}>Abrir configurações do Windows</button>}
      {note && <p role="status">{note}</p>}
      <p className="hint">{info.legacyDocNote}</p>
      <p className="hint">Ao abrir um arquivo com o LawyerMind, você revisa e confirma antes: o original não é alterado e é importada uma cópia.</p>
    </>}
  </section>;
}
