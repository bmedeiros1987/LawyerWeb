"use client";
import { useState } from "react";
import { Scissors } from "lucide-react";
import { postJson } from "./native";
import "./desktop.css";

type Version = { id: string; version: number; originalName: string | null };
type Tool = "rotate" | "delete" | "extract" | "split" | "merge";

const HELP: Record<Tool, string> = {
  rotate: "Gira as páginas indicadas. Cria uma nova versão deste documento.",
  delete: "Remove as páginas indicadas. Cria uma nova versão deste documento.",
  extract: "Mantém só as páginas indicadas, na ordem escrita (ex.: 3,1,2 reordena). Cria uma nova versão.",
  split: "Cria um documento novo para cada intervalo (um por linha, ex.: 1-3 e 4-).",
  merge: "Junta esta versão com outra, nesta ordem, em um documento novo.",
};

/** PDF page tools (own implementation). Every result is a new version or document; nothing is overwritten. */
export function PdfToolsPanel({ versions, pdfVersions }: { versions: Version[]; pdfVersions: Version[] }) {
  const [versionId, setVersionId] = useState(pdfVersions[0]?.id ?? "");
  const [tool, setTool] = useState<Tool>("rotate");
  const [pages, setPages] = useState("1");
  const [angle, setAngle] = useState<90 | 180 | 270>(90);
  const [ranges, setRanges] = useState("1-3\n4-");
  const [other, setOther] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  if (pdfVersions.length === 0) return null;
  const others = versions.filter(v => v.id !== versionId && /\.pdf$/i.test(v.originalName ?? ""));

  async function run() {
    setBusy(true); setMessage(null);
    try {
      const body =
        tool === "rotate" ? { tool, versionId, pages, angle } :
        tool === "delete" || tool === "extract" ? { tool, versionId, pages } :
        tool === "split" ? { tool, versionId, ranges: ranges.split("\n").map(r => r.trim()).filter(Boolean) } :
        { tool, versionIds: [versionId, other], name: name.trim() || undefined };
      const r = await postJson<{ created: { documentId: string; version: number }[] }>("/api/desktop/documents/pdf-tools", body);
      setMessage({ text: `Pronto: ${r.created.length === 1 ? "1 cópia nova criada" : `${r.created.length} cópias novas criadas`}. O original e a versão de origem não foram alterados.`, tone: "ok" });
      if (tool === "split" || tool === "merge") setTimeout(() => { window.location.href = `/app/documentos/${r.created[0].documentId}`; }, 900);
      else setTimeout(() => window.location.reload(), 900);
    } catch (e) { setMessage({ text: (e as Error).message, tone: "warn" }); } finally { setBusy(false); }
  }

  return <article className="panel panel-wide">
    <div className="panel-heading"><div><span className="eyebrow">Ferramentas PDF</span><h2>Páginas</h2></div></div>
    <p className="desktop-note">Funciona no seu computador, sem enviar nada para fora. O resultado é sempre uma cópia nova.</p>
    <div className="desktop-form" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))", marginTop: 8 }}>
      <label><span>Versão</span><select value={versionId} onChange={e => setVersionId(e.target.value)}>{pdfVersions.map(v => <option key={v.id} value={v.id}>Versão {v.version} · {v.originalName}</option>)}</select></label>
      <label><span>Ferramenta</span><select value={tool} onChange={e => setTool(e.target.value as Tool)}>
        <option value="rotate">Girar páginas</option><option value="delete">Remover páginas</option><option value="extract">Extrair / reordenar</option>
        <option value="split">Dividir</option><option value="merge">Juntar com outra versão</option></select></label>
      {(tool === "rotate" || tool === "delete" || tool === "extract") && <label><span>Páginas (ex.: 1-3,5,8-)</span><input value={pages} onChange={e => setPages(e.target.value)} autoComplete="off"/></label>}
      {tool === "rotate" && <label><span>Girar</span><select value={angle} onChange={e => setAngle(Number(e.target.value) as 90 | 180 | 270)}><option value={90}>90° à direita</option><option value={180}>180°</option><option value={270}>90° à esquerda</option></select></label>}
      {tool === "split" && <label style={{ gridColumn: "1 / -1" }}><span>Intervalos (um por linha)</span><textarea rows={3} value={ranges} onChange={e => setRanges(e.target.value)}/></label>}
      {tool === "merge" && <>
        <label><span>Juntar depois com</span><select value={other} onChange={e => setOther(e.target.value)}><option value="">Escolha…</option>{others.map(v => <option key={v.id} value={v.id}>Versão {v.version} · {v.originalName}</option>)}</select></label>
        <label><span>Nome do novo documento (opcional)</span><input value={name} onChange={e => setName(e.target.value)} maxLength={120}/></label></>}
    </div>
    <small>{HELP[tool]}</small>
    <div className="desktop-actions" style={{ marginTop: 8 }}>
      <button className="desktop-secondary" onClick={run} disabled={busy || !versionId || (tool === "merge" && !other)}><Scissors size={14}/>Aplicar</button>
    </div>
    {message && <p className={"desktop-note " + message.tone} role="status" style={{ marginTop: 12 }}>{message.text}</p>}
  </article>;
}
