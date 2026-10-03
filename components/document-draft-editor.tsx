"use client";

import { useEffect, useState } from "react";
import { MAX_DRAFT_TEXT } from "@/lib/documents/draft-format";
import { useDraftOperation } from "./use-draft-operation";
import { useRouter } from "next/navigation";

// Tab memory only, partitioned by authenticated user; never localStorage or a server write.
const unsaved = new Map<string, { body: string; version: number }>();

export function DocumentDraftEditor({ documentId, workspaceId, userId, canEdit }: { documentId: string; workspaceId: string; userId: string; canEdit: boolean }) {
  const router = useRouter();
  const recoveryKey = JSON.stringify([userId, workspaceId, documentId]);
  const [body, setBody] = useState("");
  const [version, setVersion] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const operation = useDraftOperation();
  const url = `/api/documents/${encodeURIComponent(documentId)}/content?workspaceId=${encodeURIComponent(workspaceId)}`;

  async function load(signal?: AbortSignal) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível abrir a minuta.");
      const pending = unsaved.get(recoveryKey);
      setBody(pending?.body ?? data.body ?? ""); setVersion(pending?.version ?? data.version); setStatus(data.status); setDirty(Boolean(pending));
      if (pending) setMessage("Texto não salvo recuperado desta aba. Revise e salve antes de sair.");
    } catch (error) {
      if (!signal?.aborted) { setVersion(null); setMessage(error instanceof Error ? error.message : "Falha ao abrir a minuta."); }
    } finally { if (!signal?.aborted) setBusy(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [url, recoveryKey]);

  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", protect);
    const protectLink = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && link.target !== "_blank" && link.href !== window.location.href && !window.confirm("Há texto não salvo. Sair desta página?")) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener("click", protectLink, true);
    return () => { window.removeEventListener("beforeunload", protect); document.removeEventListener("click", protectLink, true); };
  }, [dirty]);

  async function save() {
    if (version === null) return;
    setBusy(true); setMessage("");
    try {
      const payload = { workspaceId, expectedVersion: version, body };
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, operationId: operation.idFor(payload) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar.");
      setVersion(data.version); setStatus("DRAFT"); setDirty(false); setMessage(`Versão ${data.version} salva. Você pode fechar e reabrir este documento.`);
      operation.completed();
      unsaved.delete(recoveryKey); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao salvar. Seu texto permanece nesta tela."); }
    finally { setBusy(false); }
  }

  const editable = canEdit && ["DRAFT", "IN_REVIEW"].includes(status);
  return <article className="panel">
    <div className="panel-heading"><div><span className="eyebrow">Texto da minuta</span><h2>Revisar e salvar</h2></div></div>
    <p>O texto salvo fica disponível aos membros autorizados deste workspace. Cada salvamento mantém a versão anterior.</p>
    <div className="quick-form">
      <label><span>{version ? `Versão ${version}` : "Primeira versão"}{dirty ? " · alterações não salvas" : ""}</span>
        <textarea aria-label="Texto da minuta" rows={18} maxLength={MAX_DRAFT_TEXT} value={body} readOnly={!editable || busy || version === null} onChange={event => { setBody(event.target.value); setDirty(true); if (version !== null) unsaved.set(recoveryKey, { body: event.target.value, version }); }}/>
      </label>
      {editable && <button className="form-submit" type="button" disabled={busy || version === null || !dirty || !body.trim()} onClick={save}>{busy ? "Salvando…" : "Salvar nova versão"}</button>}
      <button type="button" className="secondary-button" disabled={busy} onClick={() => { if (!dirty || window.confirm("Descartar o texto não salvo e reabrir a versão salva?")) { unsaved.delete(recoveryKey); void load(); } }}>Reabrir versão salva</button>
      {message && <p role="status">{message}</p>}
    </div>
  </article>;
}
