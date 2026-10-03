"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MAX_DRAFT_TEXT } from "@/lib/documents/draft-format";
import { useDraftOperation } from "./use-draft-operation";

type Template = { id: string; name: string; body: string; fields: string[] };
export function DocumentTemplateWorkbench({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const templateOperation = useDraftOperation();
  const documentOperation = useDraftOperation();
  const current = templates.find(template => template.id === selected);
  const url = `/api/document-templates?workspaceId=${encodeURIComponent(workspaceId)}`;
  async function reload(signal?: AbortSignal) {
    const response = await fetch(url, { cache: "no-store", signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Não foi possível abrir os modelos.");
    setTemplates(data.templates);
  }
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal).catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, [url]);

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    setBusy(true); setMessage("");
    try {
      const payload = { workspaceId, name: values.get("name"), body: values.get("body") };
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, operationId: templateOperation.idFor(payload) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar o modelo.");
      await reload(); form.reset(); templateOperation.completed(); setSelected(data.template.id); setMessage("Modelo salvo. Preencha os campos para criar uma minuta.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao salvar."); }
    finally { setBusy(false); }
  }

  async function createDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!current) return;
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(current.fields.map((field, index) => [field, String(form.get(`value-${index}`) ?? "")]));
    setBusy(true); setMessage("");
    try {
      const payload = { workspaceId, name: form.get("documentName"), values };
      const response = await fetch(`/api/document-templates/${encodeURIComponent(current.id)}/drafts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, operationId: documentOperation.idFor({ ...payload, templateId: current.id }) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível criar a minuta.");
      router.push(`/app/documentos/${data.document.id}`); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao criar a minuta."); }
    finally { setBusy(false); }
  }

  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">Modelos do escritório</span><h2>Salvar modelo e preencher minuta</h2></div></div>
    <p>Modelos compartilhados com os membros autorizados deste workspace. Use texto simples e campos como {"{{cliente}}"}.</p>
    <details><summary>Criar modelo de texto</summary><form className="quick-form" onSubmit={createTemplate}><fieldset disabled={busy}>
      <label><span>Nome do modelo</span><input name="name" required minLength={2} maxLength={280}/></label>
      <label><span>Texto do modelo</span><textarea name="body" rows={8} required maxLength={MAX_DRAFT_TEXT} placeholder="Exemplo: Documento de {{cliente}}."/></label>
      <button className="form-submit" disabled={busy}>Salvar modelo</button>
    </fieldset></form></details>
    <div className="quick-form"><label><span>Modelo salvo</span><select value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}><option value="">Selecione um modelo</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label></div>
    {current && <form key={current.id} className="quick-form" onSubmit={createDocument}><fieldset disabled={busy}>
      <label><span>Nome do documento</span><input name="documentName" defaultValue={current.name} required minLength={2} maxLength={280}/></label>
      <details><summary>Conferir texto do modelo</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{current.body}</pre></details>
      {current.fields.map((field, index) => <label key={field}><span>{field}</span><textarea name={`value-${index}`} required maxLength={10_000} rows={2}/></label>)}
      <button className="form-submit" disabled={busy}>Preencher e abrir para revisão</button>
    </fieldset></form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
