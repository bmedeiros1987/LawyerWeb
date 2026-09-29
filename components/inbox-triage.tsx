"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Clock3, ListTodo, MoreHorizontal, XCircle } from "lucide-react";

export function InboxTriage({
  workspaceId,sourceType,sourceId,status,defaultTitle,suggestedDue,
}:{
  workspaceId:string;
  sourceType:"COURT"|"DEMAND";
  sourceId:string;
  status:string;
  defaultTitle:string;
  suggestedDue?:string|null;
}) {
  const router=useRouter();const [busy,setBusy]=useState("");const [error,setError]=useState("");

  async function act(action:"MARK_READ"|"CREATE_TASK"|"CREATE_DEADLINE"|"DISMISS",form?:HTMLFormElement){
    setBusy(action);setError("");
    const fd=form?new FormData(form):null;
    const dueRaw=fd?String(fd.get("dueAt")||""):"";
    const title=fd?String(fd.get("title")||"").trim():"";
    const r=await fetch("/api/inbox/triage",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({
        workspaceId,sourceType,sourceId,action,
        title:title||undefined,
        dueAt:dueRaw?new Date(dueRaw).toISOString():undefined,
      }),
    });
    const data=await r.json().catch(()=>({}));
    setBusy("");
    if(!r.ok){setError(data?.error??"Não foi possível concluir a triagem.");return}
    router.refresh();
  }

  const done=["TREATED","CONVERTED","DISMISSED","ARCHIVED"].includes(status);
  if(done)return <span className="status-pill success"><CheckCircle2 size={11}/>Tratado</span>;

  return <details className="inbox-triage">
    <summary className="status-pill"><MoreHorizontal size={12}/>Triar</summary>
    <form className="inbox-triage-popover" onSubmit={e=>e.preventDefault()}>
      <div className="quick-create-head"><strong>Transformar em ação</strong><span>{sourceType==="COURT"?"Tribunal":"Demanda"}</span></div>
      <label><span>Título</span><input name="title" defaultValue={defaultTitle}/></label>
      <label><span>Data sugerida</span><input name="dueAt" type="datetime-local" defaultValue={suggestedDue??""}/></label>
      <p>Para <strong>tarefa</strong>, a data vira prazo interno. Para <strong>prazo candidato</strong>, é apenas sugestão e ainda exigirá confirmação humana no Deadline Safety.</p>
      <div className="inbox-triage-actions">
        <button type="button" disabled={Boolean(busy)} onClick={e=>act("CREATE_TASK",e.currentTarget.form??undefined)}><ListTodo size={14}/>{busy==="CREATE_TASK"?"Criando…":"Criar tarefa"}</button>
        <button type="button" disabled={Boolean(busy)} onClick={e=>act("CREATE_DEADLINE",e.currentTarget.form??undefined)}><Clock3 size={14}/>{busy==="CREATE_DEADLINE"?"Criando…":"Prazo candidato"}</button>
        <button className="quiet" type="button" disabled={Boolean(busy)} onClick={()=>act("MARK_READ")}><CheckCircle2 size={14}/>Só marcar lido</button>
        <button className="danger" type="button" disabled={Boolean(busy)} onClick={()=>act("DISMISS")}><XCircle size={14}/>Descartar</button>
      </div>
      {error&&<p className="form-error">{error}</p>}
    </form>
  </details>;
}
