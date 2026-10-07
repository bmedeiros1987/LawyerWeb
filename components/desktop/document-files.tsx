"use client";
import { useState } from "react";
import { ExternalLink, Eye, FileText, FolderOpen, Save, Upload } from "lucide-react";
import { pickFile, pickSave, postJson } from "./native";
import "./desktop.css";

type Version = { id: string; version: number; originalName: string | null; sha256: string | null; createdAt: string; provenance: { originalPath?: string; originalInSyncFolder?: string | null } };

export function DesktopDocumentFiles({ documentId, versions, canEdit }: { documentId: string; versions: Version[]; canEdit: boolean }) {
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "warn" | "" } | null>(null);
  const [pending, setPending] = useState<{ versionId: string; dest: string } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<void>) {
    setBusy(true); setMessage(null);
    try { await fn(); } catch (e) { setMessage({ text: (e as Error).message, tone: "warn" }); } finally { setBusy(false); }
  }
  const open = (id: string, mode: "edit" | "read", reveal = false) => act(async () => {
    await postJson(`/api/desktop/documents/versions/${id}/open`, { mode, reveal });
    setMessage({ text: reveal ? "Pasta da cópia de trabalho aberta." : mode === "edit" ? "Cópia de trabalho aberta no programa padrão. Alterações ficam apenas nessa cópia." : "Aberta uma cópia temporária somente leitura. Alterações nela não são guardadas no LawyerMind.", tone: "ok" });
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
  const newVersion = () => act(async () => {
    const sourcePath = await pickFile("Escolher arquivo para nova versão");
    if (!sourcePath) return;
    await postJson("/api/desktop/documents/import", { sourcePath, documentId });
    window.location.reload();
  });

  return <article className="panel panel-wide">
    <div className="panel-heading"><div><span className="eyebrow">Computador</span><h2>Cópias de trabalho</h2></div>{canEdit && <button className="desktop-secondary" onClick={newVersion} disabled={busy}><Upload size={15}/>Importar nova versão</button>}</div>
    {versions.length === 0 ? <div className="mini-empty">Nenhum arquivo importado neste computador.</div> :
      <div className="desktop-rows">{versions.map(v => <div key={v.id}>
        <div><strong><FileText size={13}/> Versão {v.version} · {v.originalName}</strong>
          <small>Original (somente leitura): <span className="desktop-path">{v.provenance.originalPath ?? "—"}</span>{v.provenance.originalInSyncFolder ? " · pasta sincronizada" : ""}</small>
          <small>SHA-256 na importação: <span className="desktop-path">{v.sha256?.slice(0, 16)}…</span> · {new Date(v.createdAt).toLocaleString("pt-BR")}</small></div>
        <div className="desktop-actions">
          {canEdit && <button className="desktop-secondary" onClick={() => open(v.id, "edit")} disabled={busy}><ExternalLink size={14}/>Abrir cópia para editar</button>}
          <button className="desktop-secondary" onClick={() => open(v.id, "read")} disabled={busy}><Eye size={14}/>Abrir somente leitura</button>
          {canEdit && <button className="desktop-secondary" onClick={() => open(v.id, "edit", true)} disabled={busy}><FolderOpen size={14}/>Mostrar pasta</button>}
          <button className="desktop-secondary" onClick={() => exportClick(v)} disabled={busy}><Save size={14}/>Exportar…</button>
        </div>
      </div>)}</div>}
    {message && <p className={"desktop-note " + message.tone} role="status" style={{ marginTop: 12 }}>{message.text}</p>}
    {pending && <div className="desktop-form" style={{ maxWidth: 460 }}>
      <label><span>Para substituir o arquivo existente em <span className="desktop-path">{pending.dest}</span>, digite SOBRESCREVER</span><input value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off"/></label>
      <div className="desktop-actions"><button className="desktop-danger" disabled={busy || confirm !== "SOBRESCREVER"} onClick={() => act(() => doExport(pending.versionId, pending.dest, true, confirm))}>Substituir arquivo</button><button className="desktop-secondary" onClick={() => { setPending(null); setConfirm(""); setMessage(null); }}>Cancelar</button></div>
    </div>}
  </article>;
}
