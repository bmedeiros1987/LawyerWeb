"use client";

import { FormEvent, useState } from "react";
import { CheckCircle2, ExternalLink, Link2, Send, Unlink, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";

type BotConnection={id:string;displayName:string|null;status:string;externalIdentity:string|null;connectedAt:string|null}|null;
type Identity={status:string;displayName:string|null;verifiedAt:string|null}|null;

export function TelegramAgentSettings({
  workspaceId,canManage,connection,identity,enabled,
}:{
  workspaceId:string;
  canManage:boolean;
  connection:BotConnection;
  identity:Identity;
  enabled:boolean;
}){
  const router=useRouter();
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [deepLink,setDeepLink]=useState("");
  const [expiresAt,setExpiresAt]=useState("");

  async function connectBot(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy("bot");setError("");
    const fd=new FormData(event.currentTarget);
    const response=await fetch("/api/integrations/telegram",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      workspaceId,botToken:String(fd.get("botToken")||""),
    })});
    const data=await response.json().catch(()=>({}));
    setBusy("");
    if(!response.ok){setError(data.error??"Não foi possível conectar o bot.");return}
    event.currentTarget.reset();router.refresh();
  }

  async function disconnectBot(){
    setBusy("disconnect-bot");setError("");
    const response=await fetch("/api/integrations/telegram",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({workspaceId})});
    setBusy("");
    if(!response.ok){const data=await response.json().catch(()=>({}));setError(data.error??"Não foi possível desconectar o bot.");return}
    setDeepLink("");router.refresh();
  }

  async function pair(){
    setBusy("pair");setError("");setDeepLink("");
    const response=await fetch("/api/integrations/telegram/pair",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({workspaceId})});
    const data=await response.json().catch(()=>({}));
    setBusy("");
    if(!response.ok){setError(data.error??"Não foi possível gerar o pareamento.");return}
    if(data.paired){router.refresh();return}
    setDeepLink(data.deepLink??"");setExpiresAt(data.expiresAt??"");
  }

  async function unpair(){
    setBusy("unpair");setError("");
    const response=await fetch("/api/integrations/telegram/pair",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({workspaceId})});
    setBusy("");
    if(!response.ok){const data=await response.json().catch(()=>({}));setError(data.error??"Não foi possível remover o vínculo.");return}
    setDeepLink("");router.refresh();
  }

  async function toggle(next:boolean){
    setBusy("toggle");setError("");
    const response=await fetch("/api/agent/preferences",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({
      workspaceId,channel:"TELEGRAM",enabled:next,mode:"ASSIST",
    })});
    setBusy("");
    if(!response.ok){const data=await response.json().catch(()=>({}));setError(data.error??"Não foi possível alterar o canal.");return}
    router.refresh();
  }

  const paired=identity?.status==="VERIFIED";
  const botReady=connection?.status==="CONNECTED";

  return <section className="panel telegram-agent-panel">
    <div className="panel-heading">
      <div><span className="eyebrow">Canal oficial</span><h2>Telegram</h2></div>
      {botReady?<span className="status-pill success"><CheckCircle2 size={11}/>{connection?.displayName??"Bot conectado"}</span>:<span className="status-pill quiet">Bot não configurado</span>}
    </div>

    {!botReady&&canManage&&<form className="telegram-bot-connect quick-form" onSubmit={connectBot}>
      <label><span>Token do bot do escritório</span><input name="botToken" type="password" required autoComplete="new-password" placeholder="Cole o token fornecido pelo BotFather"/></label>
      <p className="form-hint">O LawyerMind valida o token, registra o webhook HTTPS automaticamente e armazena o segredo criptografado. O token não volta para o navegador.</p>
      <button className="form-submit" disabled={busy==="bot"}><Send size={14}/>{busy==="bot"?"Configurando…":"Conectar bot Telegram"}</button>
    </form>}

    {!botReady&&!canManage&&<div className="mini-empty">O responsável pelo workspace precisa conectar primeiro o bot Telegram do escritório.</div>}

    {botReady&&<div className="telegram-user-link">
      <div className="telegram-link-copy">
        <span className="agent-channel-icon"><Send size={18}/></span>
        <div>
          <strong>{paired?"Seu Telegram está vinculado":"Vincule seu Telegram"}</strong>
          <span>{paired?(`Conectado como ${identity?.displayName??"usuário Telegram"}.`):"O link temporário identifica apenas você dentro deste workspace."}</span>
        </div>
      </div>

      {paired?<div className="telegram-paired-actions">
        <label className="agent-switch" title="Ativar ou desativar respostas pelo Telegram">
          <input type="checkbox" checked={enabled} disabled={busy==="toggle"} onChange={e=>toggle(e.target.checked)}/><i/>
        </label>
        <button className="ghost-button" disabled={busy==="unpair"} onClick={unpair}><Unlink size={14}/>Remover vínculo</button>
      </div>:<button className="new-button" disabled={busy==="pair"} onClick={pair}><Link2 size={14}/>{busy==="pair"?"Gerando…":"Conectar meu Telegram"}</button>}
    </div>}

    {deepLink&&<div className="telegram-pair-card">
      <div><strong>Link de pareamento pronto</strong><span>Abra o Telegram e toque em Start. O link expira {expiresAt?new Date(expiresAt).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}):"em 15 minutos"}.</span></div>
      <a className="new-button" href={deepLink} target="_blank" rel="noopener noreferrer">Abrir Telegram <ExternalLink size={14}/></a>
    </div>}

    {botReady&&canManage&&<div className="telegram-admin-footer">
      <span>Bot do workspace: <strong>{connection?.displayName}</strong></span>
      <button className="danger-button" disabled={busy==="disconnect-bot"} onClick={disconnectBot}><Unplug size={14}/>Desconectar bot</button>
    </div>}

    {error&&<p className="form-error" role="alert">{error}</p>}
  </section>;
}
