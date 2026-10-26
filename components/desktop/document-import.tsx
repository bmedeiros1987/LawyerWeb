"use client";
import { useState } from "react";
import { FileUp } from "lucide-react";
import { pickFile, postJson } from "./native";
import "./desktop.css";

type Option = { id: string; label: string };

/** Explicit import: the chosen original is read once; a working copy is created outside any synced folder. */
export function DesktopImportPanel({ clients, matters }: { clients: Option[]; matters: Option[] }) {
  const [clientId, setClientId] = useState("");
  const [matterId, setMatterId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setError("");
    const sourcePath = await pickFile("Escolher documento para importar");
    if (!sourcePath) return;
    setBusy(true);
    try {
      const r = await postJson<{ documentId: string }>("/api/desktop/documents/import", { sourcePath, clientId: clientId || null, matterId: matterId || null, name: name || null });
      window.location.href = "/app/documentos/" + r.documentId;
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">Computador</span><h2>Importar arquivo</h2></div><FileUp size={18}/></div>
    <p className="desktop-note">O original (inclusive no Google Drive) é apenas lido: nunca é editado, movido, renomeado ou excluído. O LawyerMind trabalha numa cópia guardada fora de pastas sincronizadas.</p>
    <div className="desktop-form" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr)) auto", alignItems: "end" }}>
      <label><span>Cliente (opcional)</span><select value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Sem cliente</option>{clients.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label><span>Processo (opcional)</span><select value={matterId} onChange={e => setMatterId(e.target.value)}><option value="">Sem processo</option>{matters.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      <label><span>Nome (opcional)</span><input value={name} onChange={e => setName(e.target.value)} maxLength={200} placeholder="Ex.: Petição inicial"/></label>
      <button className="desktop-primary" onClick={run} disabled={busy}>{busy ? "Importando…" : "Escolher e importar"}</button>
    </div>
    {error && <p className="desktop-note warn" role="alert" style={{ marginTop: 12 }}>{error}</p>}
  </section>;
}
