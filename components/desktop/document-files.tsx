"use client";
import { useState } from "react";
import { ExternalLink, Eye, FileText, FolderOpen, Pencil, Save, Upload } from "lucide-react";
import { pickFile, pickSave, postJson } from "./native";
import { comparePath, openInNewWindow } from "./windows";
import { PdfToolsPanel } from "./pdf-tools-panel";
import "./desktop.css";

type Version = { id: string; version: number; originalName: string | null; sha256: string | null; createdAt: string; provenance: { originalPath?: string; originalInSyncFolder?: string | null; derived?: { operation: string; fromVersionIds: string[] } } };

export function DesktopDocumentFiles({ documentId, versions, canEdit, editors }: { documentId: string; versions: Version[]; canEdit: boolean; editors?: { pdf: boolean; word: boolean } }) {
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "warn" | "" } | null>(null);
  const [pending, setPending] = useState<{ versionId: string; dest: string } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<void>) {
    setBusy(true); setMessage(null);
    try { await fn(); } catch (e) { setMessage({ text: (e as Error).message, tone: "warn" }); } finally { setBusy(false); }
  }
  const open = (id: string, mode: "edit" | "read" | "editor", reveal = false) => act(async () => {
    await postJson(`/api/desktop/documents/versions/${id}/open`, { mode, reveal });
    setMessage({ text: reveal ? "Pasta da cópia de trabalho aberta." : mode === "editor" ? "Cópia de trabalho aberta no editor do LawyerMind. O que você salvar fica só nessa cópia; o original não é tocado." : mode === "edit" ? "Cópia de trabalho aberta no programa padrão. Alterações ficam apenas nessa cópia." : "Aberta uma cópia temporária somente leitura. Alterações nela não são guardadas no LawyerMind.", tone: "ok" });
  });
  async function doExport(versionId: string, dest: string, overwrite = false, confirmation?: string) {
    try {
      const r = await postJson<{ path: string; replaced: boolean; syncFolder: string | null }>(`/api/desktop/documents/versions/${versionId}/export`, { destPath: dest, overwrite, confirmation });
      setPending(null); setConfirm("");
      setMessage({ text: `Exportado para ${r.path}${r.replaced ? " (arquivo anterior substituído)" : ""}.${r.syncFolder ? ` Atenção: destino em pasta sincronizada ("${r.syncFolder}"). A sincronização pode estar parcial e edições em outro computador podem gerar conflito.` : ""}`, tone: r.syncFolder ? "warn" : "ok" });
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "exists" || err.code === "confirm") { setPending({ versionId, dest }); setMessage({ text: err.message, tone: "warn" }); }
      else throw e;
    }
  }
  const exportClick = (v: Version) => act(async () => {
    const dest = await pickSave("Exportar cópia", v.originalName ?? "documento");
    if (dest) await doExport(v.id, dest);
  });
  const [cmpL, setCmpL] = useState(versions[1]?.id ?? ""), [cmpR, setCmpR] = useState(versions[0]?.id ?? "");
  const compareTwoWindows = () => act(async () => { await openInNewWindow(comparePath(cmpL, cmpR, "esq")); await openInNewWindow(comparePath(cmpL, cmpR, "dir")); });
  const newVersion = () => act(async () => {
    const sourcePath = await pickFile("Escolher arquivo para nova versão");
    if (!sourcePath) return;
    await postJson("/api/desktop/documents/import", { sourcePath, documentId });
    window.location.reload();
  });

  const pdfVersions = versions.filter(v => /\.pdf$/i.test(v.originalName ?? ""));
  return <>
  <article className="panel panel-wide">
    <div className="panel-heading"><div><span className="eyebrow">Computador</span><h2>Cópias de trabalho</h2></div>{canEdit && <button className="desktop-secondary" onClick={newVersion} disabled={busy}><Upload size={15}/>Importar nova versão</button>}</div>
    {versions.length === 0 ? <div className="mini-empty">Nenhum arquivo importado neste computador.</div> :
      <div className="desktop-rows">{versions.map(v => <div key={v.id}>
        <div><strong><FileText size={13}/> Versão {v.version} · {v.originalName}</strong>
          <small>{v.provenance.derived ? "Gerado no LawyerMind" : "Original (somente leitura)"}: <span className="desktop-path">{v.provenance.originalPath ?? "—"}</span>{v.provenance.originalInSyncFolder ? " · pasta sincronizada" : ""}</small>
          <small>SHA-256 na importação: <span className="desktop-path">{v.sha256?.slice(0, 16)}…</span> · {new Date(v.createdAt).toLocaleString("pt-BR")}</small></div>
        <div className="desktop-actions">
          {canEdit && (/\.pdf$/i.test(v.originalName ?? "") ? editors?.pdf : /\.docx$/i.test(v.originalName ?? "") ? editors?.word : false) && <button className="desktop-secondary" onClick={() => open(v.id, "editor")} disabled={busy}><Pencil size={14}/>Editar no LawyerMind</button>}
          {canEdit && <button className="desktop-secondary" onClick={() => open(v.id, "edit")} disabled={busy}><ExternalLink size={14}/>Abrir cópia para editar</button>}
          <button className="desktop-secondary" onClick={() => open(v.id, "read")} disabled={busy}><Eye size={14}/>Abrir somente leitura</button>
          <a className="desktop-secondary" href={`/app/documentos/${documentId}/assistente/${v.id}`}>Conversar sobre o texto (IA)</a>
          {canEdit && <button className="desktop-secondary" onClick={() => open(v.id, "edit", true)} disabled={busy}><FolderOpen size={14}/>Mostrar pasta</button>}
          <button className="desktop-secondary" onClick={() => exportClick(v)} disabled={busy}><Save size={14}/>Exportar…</button>
        </div>
      </div>)}</div>}
    {versions.length >= 2 && <div className="desktop-form" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr)) auto auto", alignItems: "end", marginTop: 12 }}>
      <label><span>Comparar (esquerda)</span><select value={cmpL} onChange={e => setCmpL(e.target.value)}>{versions.map(v => <option key={v.id} value={v.id}>Versão {v.version}</option>)}</select></label>
      <label><span>com (direita)</span><select value={cmpR} onChange={e => setCmpR(e.target.value)}>{versions.map(v => <option key={v.id} value={v.id}>Versão {v.version}</option>)}</select></label>
      <a className="desktop-secondary" href={comparePath(cmpL, cmpR)} aria-disabled={cmpL === cmpR}>Comparar lado a lado</a>
      <button className="desktop-secondary" onClick={compareTwoWindows} disabled={busy || cmpL === cmpR}>Abrir em duas janelas</button>
    </div>}
    {message && <p className={"desktop-note " + message.tone} role="status" style={{ marginTop: 12 }}>{message.text}</p>}
    {pending && <div className="desktop-form" style={{ maxWidth: 460 }}>
      <label><span>Para substituir o arquivo existente em <span className="desktop-path">{pending.dest}</span>, digite SOBRESCREVER</span><input value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off"/></label>
      <div className="desktop-actions"><button className="desktop-danger" disabled={busy || confirm !== "SOBRESCREVER"} onClick={() => act(() => doExport(pending.versionId, pending.dest, true, confirm))}>Substituir arquivo</button><button className="desktop-secondary" onClick={() => { setPending(null); setConfirm(""); setMessage(null); }}>Cancelar</button></div>
    </div>}
  </article>
  {canEdit && <PdfToolsPanel versions={versions} pdfVersions={pdfVersions}/>}
  </>;
}
