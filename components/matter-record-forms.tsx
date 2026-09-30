"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function MatterRecordForms({ matterId, clients, people, phases }: {
  matterId: string; clients: { id: string; name: string }[];
  people: { id: string; name: string }[]; phases: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  async function submit(event: FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget, fd = new FormData(form);
    const body: Record<string, unknown> = { action, requestId };
    for (const [key, value] of fd) if (String(value).trim()) body[key] = String(value).trim();
    setBusy(true); setError("");
    try {
      for (const key of ["startedAt", "occurredAt"]) if (body[key]) body[key] = new Date(String(body[key])).toISOString();
      const response = await fetch(`/api/matters/${matterId}/records`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? "Não foi possível registrar."); return; }
      form.reset(); setRequestId(crypto.randomUUID()); router.refresh();
    } catch { setError("Falha de conexão. Atualize o processo antes de tentar novamente."); }
    finally { setBusy(false); }
  }
  return <div className="quick-form">
    <details><summary>Vincular parte</summary><form className="quick-form" onSubmit={event => submit(event, "ADD_PARTY")}>
      <p className="form-hint">Escolha uma pessoa ou cliente existente. Preencha o nome somente para uma pessoa nova.</p>
      <label><span>Pessoa já vinculada</span><select name="personId" defaultValue=""><option value="">Selecionar</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label><span>Cliente existente</span><select name="clientId" defaultValue=""><option value="">Selecionar</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label><span>Nome da nova pessoa</span><input name="name" maxLength={260}/></label>
      <label><span>Tipo da nova pessoa</span><select name="kind"><option value="INDIVIDUAL">Pessoa física</option><option value="LEGAL_ENTITY">Pessoa jurídica</option></select></label>
      <div className="quick-form-grid"><label><span>Papel no processo</span><input name="role" required maxLength={80} placeholder="Autor, réu, testemunha…"/></label><label><span>Polo</span><select name="side"><option value="OTHER">Outro / terceiro</option><option value="CLAIMANT">Ativo</option><option value="RESPONDENT">Passivo</option></select></label></div>
      <button className="form-submit" disabled={busy}>Vincular parte</button>
    </form></details>
    <details><summary>Registrar fase</summary><form className="quick-form" onSubmit={event => submit(event, "ADD_PHASE")}>
      <label><span>Nome da fase</span><input name="name" required maxLength={160}/></label>
      <label><span>Tipo</span><select name="kind"><option value="FIRST_INSTANCE">Primeira instância</option><option value="APPEAL">Recurso / instância superior</option><option value="ENFORCEMENT">Liquidação / execução</option><option value="PRE_LITIGATION">Pré-processual</option><option value="ADMINISTRATIVE">Administrativa</option><option value="OTHER">Outra</option></select></label>
      <div className="quick-form-grid"><label><span>Número nesta fase</span><input name="number" maxLength={80}/></label><label><span>Órgão / tribunal</span><input name="court" maxLength={180}/></label></div>
      <label><span>Início</span><input name="startedAt" type="datetime-local" required/></label>
      <label><span>Observações</span><textarea name="notes" maxLength={8000} rows={2}/></label>
      <p className="form-hint">A nova fase passa a ser a fase exibida no resumo. As fases anteriores permanecem no histórico.</p>
      <button className="form-submit" disabled={busy}>Registrar fase</button>
    </form></details>
    <details><summary>Registrar andamento</summary><form className="quick-form" onSubmit={event => submit(event, "ADD_MOVEMENT")}>
      <label><span>Descrição breve</span><input name="title" required maxLength={300}/></label>
      <label><span>Data do andamento</span><input name="occurredAt" type="datetime-local" required/></label>
      <label><span>Fase</span><select name="phaseId" defaultValue=""><option value="">Sem fase específica</option>{phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label><span>Detalhes</span><textarea name="description" maxLength={20000} rows={3}/></label>
      <label><span>Link da fonte</span><input name="sourceUrl" type="url" placeholder="https://"/></label>
      <p className="form-hint">Registro manual. Não cria nem confirma prazo automaticamente.</p>
      <button className="form-submit" disabled={busy}>Registrar andamento</button>
    </form></details>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
