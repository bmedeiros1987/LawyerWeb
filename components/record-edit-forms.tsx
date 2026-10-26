"use client";

import { FormEvent, useState } from "react";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { QuickCreateShell } from "./quick-create-shell";

type ClientData = { id: string; type: string; name: string; legalName: string | null; cpfCnpj: string | null; email: string | null; phone: string | null; notes: string | null };
type MatterData = { id: string; number: string | null; internalCode: string | null; title: string; practiceArea: string | null; court: string | null; jurisdiction: string | null; courtUnit: string | null; phase: string | null };

async function patch(url: string, body: Record<string, FormDataEntryValue>) {
  const r = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error ?? "Não foi possível salvar.");
}

function useSave(url: string) {
  const router = useRouter(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError(""); setSaved(false);
    try { await patch(url, Object.fromEntries(new FormData(e.currentTarget))); setSaved(true); router.refresh(); }
    catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  }
  return { submit, error, saving, saved };
}

export function EditClientForm({ client }: { client: ClientData }) {
  const s = useSave(`/api/clients/${client.id}`);
  return <QuickCreateShell title="Editar cliente" summary={<><Pencil size={15}/>Editar</>}><form className="quick-form" onSubmit={s.submit}>
    <label><span>Tipo</span><select name="type" defaultValue={client.type}><option value="LEGAL_ENTITY">Pessoa jurídica</option><option value="INDIVIDUAL">Pessoa física</option></select></label>
    <label><span>Nome</span><input name="name" required minLength={2} maxLength={180} defaultValue={client.name}/></label>
    <label><span>Razão social / nome completo</span><input name="legalName" maxLength={220} defaultValue={client.legalName ?? ""}/></label>
    <div className="quick-form-grid"><label><span>CPF/CNPJ</span><input name="cpfCnpj" maxLength={24} defaultValue={client.cpfCnpj ?? ""}/></label><label><span>Telefone</span><input name="phone" maxLength={40} defaultValue={client.phone ?? ""}/></label></div>
    <label><span>E-mail</span><input name="email" type="email" defaultValue={client.email ?? ""}/></label>
    <label><span>Observações</span><textarea name="notes" rows={3} defaultValue={client.notes ?? ""}/></label>
    {s.error && <p className="form-error">{s.error}</p>}{s.saved && <p role="status">Alterações salvas.</p>}
    <button className="form-submit" disabled={s.saving}>{s.saving ? "Salvando…" : "Salvar alterações"}</button>
  </form></QuickCreateShell>;
}

export function EditMatterForm({ matter }: { matter: MatterData }) {
  const s = useSave(`/api/matters/${matter.id}`);
  return <QuickCreateShell title="Editar processo" summary={<><Pencil size={15}/>Editar</>}><form className="quick-form" onSubmit={s.submit}>
    <label><span>Título / assunto</span><input name="title" required minLength={2} maxLength={240} defaultValue={matter.title}/></label>
    <div className="quick-form-grid"><label><span>Número (CNJ)</span><input name="number" maxLength={80} defaultValue={matter.number ?? ""}/></label><label><span>Pasta interna</span><input name="internalCode" maxLength={80} defaultValue={matter.internalCode ?? ""}/></label></div>
    <div className="quick-form-grid"><label><span>Área</span><input name="practiceArea" maxLength={100} defaultValue={matter.practiceArea ?? ""}/></label><label><span>Tribunal</span><input name="court" maxLength={120} defaultValue={matter.court ?? ""}/></label></div>
    <div className="quick-form-grid"><label><span>Vara / unidade</span><input name="courtUnit" maxLength={160} defaultValue={matter.courtUnit ?? ""}/></label><label><span>Comarca</span><input name="jurisdiction" maxLength={120} defaultValue={matter.jurisdiction ?? ""}/></label></div>
    <label><span>Fase</span><input name="phase" maxLength={120} defaultValue={matter.phase ?? ""}/></label>
    {s.error && <p className="form-error">{s.error}</p>}{s.saved && <p role="status">Alterações salvas.</p>}
    <button className="form-submit" disabled={s.saving}>{s.saving ? "Salvando…" : "Salvar alterações"}</button>
  </form></QuickCreateShell>;
}
