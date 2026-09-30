"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bot, Check, CheckCircle2, Clock3, Copy, ListTodo, MoreHorizontal, XCircle } from "lucide-react";

export function InboxTriage({
  workspaceId,sourceType,sourceId,status,defaultTitle,suggestedDue,canCreateTask,canCreateDeadline,canGenerateAgentDraft,
}:{
  workspaceId:string;
  sourceType:"COURT"|"DEMAND";
  sourceId:string;
  status:string;
  defaultTitle:string;
  suggestedDue?:string|null;
  canCreateTask:boolean;
  canCreateDeadline:boolean;
  canGenerateAgentDraft?:boolean;
}) {
  const router=useRouter();const [busy,setBusy]=useState("");const [error,setError]=useState("");
  const [draft,setDraft]=useState("");const [copied,setCopied]=useState(false);

  const [localDue,setLocalDue]=useState("");
  useEffect(()=>{
    if(!suggestedDue){setLocalDue("");return;}
    const date=new Date(suggestedDue);
    setLocalDue(new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16));
  },[suggestedDue]);

  async function act(action:"MARK_READ"|"CREATE_TASK"|"CREATE_DEADLINE"|"DISMISS",form?:HTMLFormElement){
    setBusy(action);setError("");
    const fd=form?new FormData(form):null;
    const dueRaw=fd?String(fd.get("dueAt")||""):"";
    const title=fd?String(fd.get("title")||"").trim():"";
    try {
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
    }catch{setError("Falha de conexão. Atualize a caixa antes de tentar novamente.");}
    finally{setBusy("");}
  }

  async function generateDraft(){
    if(sourceType!=="DEMAND")return;
    setBusy("AGENT_DRAFT");setError("");setDraft("");setCopied(false);
    try{
      const r=await fetch("/api/agent/email-draft",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({workspaceId,demandId:sourceId}),
      });
      const data=await r.json().catch(()=>({}));
      if(!r.ok){setError(data?.error??"Não foi possível gerar o rascunho.");return}
      setDraft(String(data?.text??"").trim());
    }catch{setError("Falha de conexão com o agente. Tente novamente.");}
    finally{setBusy("");}
  }

  async function copyDraft(){
    if(!draft)return;
    try{
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      window.setTimeout(()=>setCopied(false),1500);
    }catch{setError("Não foi possível copiar o rascunho.");}
  }

  const done=["TREATED","CONVERTED","DISMISSED","ARCHIVED"].includes(status);
  if(done)return <span className="status-pill success"><CheckCircle2 size={11}/>{["DISMISSED","ARCHIVED"].includes(status)?"Descartado":"Tratado"}</span>;

  return <details className="inbox-triage">
    <summary className="status-pill"><MoreHorizontal size={12}/>Triar</summary>
    <form className="inbox-triage-popover" onSubmit={e=>e.preventDefault()}>
      <div className="quick-create-head"><strong>Transformar em ação</strong><span>{sourceType==="COURT"?"Tribunal":"Demanda"}</span></div>
      <label><span>Título</span><input name="title" defaultValue={defaultTitle} maxLength={300}/></label>
      <label><span>Data sugerida</span><input name="dueAt" type="datetime-local" value={localDue} onChange={e=>setLocalDue(e.target.value)}/></label>
      <p>Para <strong>tarefa</strong>, a data vira prazo interno. Para <strong>prazo candidato</strong>, é apenas sugestão e ainda exigirá confirmação humana no Deadline Safety.</p>
      <div className="inbox-triage-actions">
        {canCreateTask&&<button type="button" disabled={Boolean(busy)} onClick={e=>act("CREATE_TASK",e.currentTarget.form??undefined)}><ListTodo size={14}/>{busy==="CREATE_TASK"?"Criando…":"Criar tarefa"}</button>}
        {canCreateDeadline&&<button type="button" disabled={Boolean(busy)} onClick={e=>act("CREATE_DEADLINE",e.currentTarget.form??undefined)}><Clock3 size={14}/>{busy==="CREATE_DEADLINE"?"Criando…":"Prazo candidato"}</button>}
        <button className="quiet" type="button" disabled={Boolean(busy)} onClick={()=>act("MARK_READ")}><CheckCircle2 size={14}/>Só marcar lido</button>
        <button className="danger" type="button" disabled={Boolean(busy)} onClick={()=>act("DISMISS")}><XCircle size={14}/>Descartar</button>
      </div>
      {canGenerateAgentDraft&&<div className="inbox-agent-draft">
        <div className="inbox-agent-draft-head">
          <div><Bot size={15}/><span><strong>MBLZ Agent</strong><small>Gera apenas um rascunho. Nada é enviado automaticamente.</small></span></div>
          <button type="button" disabled={Boolean(busy)} onClick={generateDraft}><Bot size={13}/>{busy==="AGENT_DRAFT"?"Redigindo…":draft?"Gerar novamente":"Gerar rascunho"}</button>
        </div>
        {draft&&<div className="inbox-agent-draft-copy">
          <p>{draft}</p>
          <button type="button" onClick={copyDraft}>{copied?<Check size={13}/>:<Copy size={13}/>} {copied?"Copiado":"Copiar texto"}</button>
        </div>}
      </div>}
      {error&&<p className="form-error">{error}</p>}
    </form>
  </details>;
}
