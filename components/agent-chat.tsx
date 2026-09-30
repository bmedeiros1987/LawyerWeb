"use client";

import { FormEvent, useState } from "react";
import { ArrowUp, Bot, LoaderCircle, ShieldCheck, UserRound } from "lucide-react";

type ChatMessage = { role: "user" | "assistant"; text: string };

export function AgentChat({ configured }:{ configured:boolean }) {
  const [messages,setMessages]=useState<ChatMessage[]>([]);
  const [value,setValue]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message=value.trim();
    if(!message||busy||!configured)return;
    setMessages(current=>[...current,{role:"user",text:message}]);
    setValue("");setBusy(true);setError("");
    try{
      const response=await fetch("/api/agent/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data?.error??"Não foi possível consultar o agente.");
      setMessages(current=>[...current,{role:"assistant",text:String(data.reply??"")}]);
    }catch(e){
      setError(e instanceof Error?e.message:"Não foi possível consultar o agente.");
    }finally{setBusy(false)}
  }

  return <section className="agent-chat">
    <div className="agent-chat-head">
      <div className="agent-avatar"><Bot size={19}/></div>
      <div><strong>MBLZ Agent</strong><span>{configured?"OpenClaw conectado · contexto autorizado do MBLZ":"Gateway OpenClaw ainda não configurado"}</span></div>
      <span className={"status-pill "+(configured?"success":"quiet")}>{configured?"Disponível":"Setup"}</span>
    </div>
    <div className="agent-chat-body">
      {messages.length===0?<div className="agent-empty"><ShieldCheck size={22}/><strong>Converse com o jurídico sem abrir toda a complexidade do sistema.</strong><span>O agente enxerga somente o que seu perfil pode ver. Prazos fatais, envios externos, assinaturas e exclusões continuam exigindo ação humana.</span></div>:
      messages.map((m,i)=><div className={"agent-message "+m.role} key={i}><span>{m.role==="assistant"?<Bot size={15}/>:<UserRound size={15}/>}</span><p>{m.text}</p></div>)}
      {busy&&<div className="agent-message assistant"><span><LoaderCircle className="spin" size={15}/></span><p>Consultando o contexto autorizado…</p></div>}
    </div>
    {error&&<p className="form-error agent-error">{error}</p>}
    <form className="agent-composer" onSubmit={submit}>
      <textarea value={value} onChange={e=>setValue(e.target.value)} rows={2} maxLength={12000} disabled={!configured||busy} placeholder={configured?"Pergunte sobre seus prazos, tarefas, processos recentes ou contratos…":"Configure o OpenClaw para ativar o MBLZ Agent."}/>
      <button disabled={!configured||busy||value.trim().length<2} aria-label="Enviar"><ArrowUp size={17}/></button>
    </form>
  </section>;
}
