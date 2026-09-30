"use client";

import { FormEvent, useMemo, useState } from "react";
import { Bot, CheckCircle2, Mail, MessageCircle, Send, ShieldCheck, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";

type Connection = {
  gatewayUrl:string;
  agentId:string;
  status:string;
  lastHealthAt:string|null;
}|null;

type Preference={channel:string;enabled:boolean;mode:string};

export function OpenClawAgentSettings({
  workspaceId,connection,canManage,preferences,gmailConnected,
}:{
  workspaceId:string;
  connection:Connection;
  canManage:boolean;
  preferences:Preference[];
  gmailConnected:boolean;
}){
  const router=useRouter();
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [reply,setReply]=useState("");
  const pref=useMemo(()=>new Map(preferences.map(p=>[p.channel,p])),[preferences]);

  async function connect(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy("connect");setError("");
    const fd=new FormData(event.currentTarget);
    const response=await fetch("/api/integrations/openclaw",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      workspaceId,gatewayUrl:String(fd.get("gatewayUrl")||""),gatewayToken:String(fd.get("gatewayToken")||""),agentId:String(fd.get("agentId")||"mblz"),
    })});
    const data=await response.json().catch(()=>({}));
    setBusy("");
    if(!response.ok){setError(data.error??"Falha ao conectar.");return}
    router.refresh();
  }

  async function disconnect(){
    setBusy("disconnect");setError("");
    const response=await fetch("/api/integrations/openclaw",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({workspaceId})});
    setBusy("");
    if(!response.ok){const data=await response.json().catch(()=>({}));setError(data.error??"Falha ao desconectar.");return}
    router.refresh();
  }

  async function toggle(channel:"EMAIL"|"TELEGRAM"|"WHATSAPP",enabled:boolean){
    setBusy(channel);setError("");
    const response=await fetch("/api/agent/preferences",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({workspaceId,channel,enabled,mode:"DRAFT"})});
    setBusy("");
    if(!response.ok){const data=await response.json().catch(()=>({}));setError(data.error??"Falha ao salvar.");return}
    router.refresh();
  }

  async function ask(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy("chat");setError("");setReply("");
    const fd=new FormData(event.currentTarget);
    const message=String(fd.get("message")||"").trim();
    if(!message){setBusy("");return}
    const response=await fetch("/api/agent/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({workspaceId,channel:"WEB",threadId:"integration-test",message})});
    const data=await response.json().catch(()=>({}));
    setBusy("");
    if(!response.ok){setError(data.error??"O agente não respondeu.");return}
    setReply(data.text??"");
  }

  return <div className="agent-settings-grid">
    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">Runtime</span><h2>OpenClaw Gateway</h2></div>{connection?<span className="status-pill success"><CheckCircle2 size={11}/>Conectado</span>:<span className="status-pill quiet">Não conectado</span>}</div>
      {connection?<div className="agent-connection-summary">
        <div><span>Gateway</span><strong>{connection.gatewayUrl}</strong></div>
        <div><span>Agente</span><strong>{connection.agentId}</strong></div>
        <div><span>Último teste</span><strong>{connection.lastHealthAt?new Date(connection.lastHealthAt).toLocaleString("pt-BR"):"—"}</strong></div>
        {canManage&&<button className="danger-button" disabled={busy==="disconnect"} onClick={disconnect}><Unplug size={14}/>Desconectar</button>}
      </div>:canManage?<form className="quick-form" onSubmit={connect}>
        <label><span>URL HTTPS do Gateway</span><input name="gatewayUrl" type="url" required placeholder="https://mblz-openclaw.onrender.com"/></label>
        <div className="quick-form-grid">
          <label><span>Agent ID</span><input name="agentId" defaultValue="mblz" required/></label>
          <label><span>Token do Gateway</span><input name="gatewayToken" type="password" required autoComplete="new-password"/></label>
        </div>
        <p className="form-hint">O token é enviado somente ao servidor MBLZ e armazenado criptografado. Ele nunca é devolvido ao navegador.</p>
        <button className="form-submit" disabled={busy==="connect"}><Bot size={15}/>{busy==="connect"?"Testando…":"Conectar OpenClaw"}</button>
      </form>:<div className="mini-empty">A conexão do Gateway é configurada pelo responsável pelo workspace.</div>}
    </section>

    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">Opt-in</span><h2>Meus canais</h2></div><ShieldCheck size={17}/></div>
      <div className="agent-channel-list">
        <div className="agent-channel-row">
          <span className="agent-channel-icon"><Mail size={18}/></span>
          <div><strong>E-mail</strong><span>{gmailConnected?"Gmail conectado. O agente trabalhará em modo rascunho por padrão.":"Conecte o Gmail antes de habilitar o agente."}</span></div>
          <label className="agent-switch"><input type="checkbox" checked={Boolean(pref.get("EMAIL")?.enabled)} disabled={!gmailConnected||busy==="EMAIL"} onChange={e=>toggle("EMAIL",e.target.checked)}/><i/></label>
        </div>
        <div className="agent-channel-row">
          <span className="agent-channel-icon"><Send size={18}/></span>
          <div><strong>Telegram</strong><span>Bot oficial por workspace + pareamento individual. A configuração detalhada fica logo abaixo.</span></div>
          <span className="status-pill success">Disponível</span>
        </div>
        <div className="agent-channel-row">
          <span className="agent-channel-icon"><MessageCircle size={18}/></span>
          <div><strong>WhatsApp</strong><span>Produção via WhatsApp Business Cloud API, sem WhatsApp Web automatizado.</span></div>
          <span className="status-pill quiet">Preparando</span>
        </div>
      </div>
    </section>

    <section className="panel agent-test-panel">
      <div className="panel-heading"><div><span className="eyebrow">Teste seguro</span><h2>Conversar com o agente MBLZ</h2></div><Bot size={18}/></div>
      {connection?<form className="agent-chat-form" onSubmit={ask}>
        <textarea name="message" rows={4} maxLength={12000} placeholder="Ex.: Quais são meus prazos e tarefas mais importantes de hoje?"/>
        <button className="new-button" disabled={busy==="chat"}><Send size={14}/>{busy==="chat"?"Consultando…":"Enviar"}</button>
      </form>:<div className="mini-empty">Conecte primeiro um Gateway OpenClaw.</div>}
      {reply&&<div className="agent-reply"><strong>MBLZ Agent</strong><p>{reply}</p></div>}
    </section>

    {error&&<section className="panel contract-alert"><div><strong>Não foi possível concluir.</strong><span>{error}</span></div></section>}
  </div>;
}
