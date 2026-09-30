"use client";

import { FormEvent, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";

export function DeadlineConfirm({
  id, workspaceId, members, currentUserId,
}:{
  id:string;
  workspaceId:string;
  members:{userId:string;name:string}[];
  currentUserId:string;
}) {
  const router=useRouter();
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError("");
    const fd=new FormData(event.currentTarget);
    const dueAt=String(fd.get("dueAt")||"");
    const internalDueAt=String(fd.get("internalDueAt")||"");
    const reviewerUserId=String(fd.get("reviewerUserId")||"");
    if(!dueAt || !internalDueAt || !reviewerUserId){setError("Informe prazo legal, prazo interno e revisor.");setSaving(false);return}
    try {
    const response=await fetch("/api/deadlines/"+id+"/confirm",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        workspaceId,
        primaryResponsibleUserId:String(fd.get("primaryResponsibleUserId")||currentUserId),
        reviewerUserId,
        dueAt:new Date(dueAt).toISOString(),
        internalDueAt:internalDueAt?new Date(internalDueAt).toISOString():null,
        ruleSummary:String(fd.get("ruleSummary")||"")||null,
      }),
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){setError(data?.error??"Não foi possível confirmar o prazo.");setSaving(false);return}
    router.refresh();
    }catch{setError("Falha de conexão. Atualize a lista para verificar a confirmação.");}
    finally{setSaving(false);}
  }

  return <details className="deadline-confirm">
    <summary className="status-pill">Confirmar</summary>
    <form className="quick-form deadline-confirm-popover" onSubmit={submit}>
      <div className="quick-create-head"><strong>Confirmar prazo</strong><CheckCircle2 size={16}/></div>
      <div className="quick-form-grid">
        <label><span>Prazo legal</span><input name="dueAt" type="datetime-local" required/></label>
        <label><span>Prazo interno</span><input name="internalDueAt" type="datetime-local" required/></label>
      </div>
      <div className="quick-form-grid">
        <label><span>Responsável</span><select name="primaryResponsibleUserId" defaultValue={currentUserId}>{members.map(m=><option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
        <label><span>Revisor</span><select name="reviewerUserId" defaultValue=""><option value="">Escolha</option>{members.map(m=><option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
      </div>
      <label><span>Regra / fundamento conferido</span><textarea name="ruleSummary" rows={3} required placeholder="Registre o termo inicial, a regra aplicada e a fonte conferida."/></label>
      {error&&<p className="form-error">{error}</p>}
      <button className="form-submit" disabled={saving}>{saving?"Confirmando…":"Confirmar prazo"}</button>
    </form>
  </details>;
}
