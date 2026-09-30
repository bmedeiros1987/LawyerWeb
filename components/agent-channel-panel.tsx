"use client";

import { useState } from "react";
import { Mail, MessageCircle, Send } from "lucide-react";

export type AgentChannelSummary = {
  id:string; channel:"WEB"|"EMAIL"|"WHATSAPP"|"TELEGRAM"; status:string; displayName:string|null; maskedAddress:string|null;
};

export function AgentChannelPanel({ initial, gmailConnected }:{ initial:AgentChannelSummary[]; gmailConnected:boolean }) {
  const [channels,setChannels]=useState(initial);
  const [busy,setBusy]=useState("");
  const [note,setNote]=useState("");

  async function prepare(channel:"EMAIL"|"WHATSAPP"|"TELEGRAM"){
    setBusy(channel);setNote("");
    const response=await fetch("/api/agent/channels/prepare",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({channel})});
    const data=await response.json().catch(()=>({}));
    setBusy("");
    if(!response.ok){setNote(data?.error??"Não foi possível preparar o canal.");return}
    const next=data.connection as AgentChannelSummary;
    setChannels(current=>[...current.filter(c=>c.channel!==channel),next]);
    if(data.setup==="BOT_TOKEN_REQUIRED")setNote("Telegram preparado. O próximo passo será informar o token do bot ao Gateway OpenClaw em uma tela protegida.");
    else if(data.setup==="QR_PAIRING_REQUIRED")setNote("WhatsApp preparado. O próximo passo será escanear o QR do Gateway OpenClaw.");
    else setNote("E-mail habilitado para o MBLZ Agent.");
  }

  async function disconnect(channel:"EMAIL"|"WHATSAPP"|"TELEGRAM"){
    setBusy("disconnect-"+channel);setNote("");
    const response=await fetch("/api/agent/channels/disconnect",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({channel})});
    const data=await response.json().catch(()=>({}));
    setBusy("");
    if(!response.ok){setNote(data?.error??"Não foi possível desconectar o canal.");return}
    setChannels(current=>current.map(c=>c.channel===channel?{...c,status:"DISCONNECTED"}:c));
    setNote("Canal revogado no MBLZ. O contexto jurídico deixa de ser fornecido imediatamente.");
  }

  function status(channel:string){
    return channels.find(c=>c.channel===channel);
  }

  const email=status("EMAIL"), telegram=status("TELEGRAM"), whatsapp=status("WHATSAPP");
  return <div className="agent-channels">
    <article className="agent-channel-row"><span className="agent-channel-icon"><Mail size={18}/></span><div><strong>E-mail</strong><span>{email?.status==="CONNECTED"?(email.maskedAddress??"Gmail conectado"):gmailConnected?"Gmail conectado; habilite o agente quando quiser.":"Conecte o Gmail primeiro."}</span></div>{email?.status==="CONNECTED"?<button className="channel-disconnect" disabled={busy==="disconnect-EMAIL"} onClick={()=>disconnect("EMAIL")}>Desconectar</button>:<button disabled={!gmailConnected||busy==="EMAIL"} onClick={()=>prepare("EMAIL")}>Habilitar</button>}</article>
    <article className="agent-channel-row"><span className="agent-channel-icon"><Send size={18}/></span><div><strong>Telegram</strong><span>{telegram?.status==="PENDING"?"Aguardando token/pareamento":telegram?.status==="CONNECTED"?"Conectado":"Opcional · bot dedicado por usuário ou equipe"}</span></div>{telegram?.status==="CONNECTED"?<button className="channel-disconnect" disabled={busy==="disconnect-TELEGRAM"} onClick={()=>disconnect("TELEGRAM")}>Desconectar</button>:<button disabled={busy==="TELEGRAM"} onClick={()=>prepare("TELEGRAM")}>{telegram?.status==="PENDING"?"Retomar":"Preparar"}</button>}</article>
    <article className="agent-channel-row"><span className="agent-channel-icon"><MessageCircle size={18}/></span><div><strong>WhatsApp</strong><span>{whatsapp?.status==="PENDING"?"Aguardando QR":whatsapp?.status==="CONNECTED"?"Conectado":"Opcional · recomendamos número dedicado ao agente"}</span></div>{whatsapp?.status==="CONNECTED"?<button className="channel-disconnect" disabled={busy==="disconnect-WHATSAPP"} onClick={()=>disconnect("WHATSAPP")}>Desconectar</button>:<button disabled={busy==="WHATSAPP"} onClick={()=>prepare("WHATSAPP")}>{whatsapp?.status==="PENDING"?"Retomar":"Preparar"}</button>}</article>
    {note&&<p className="agent-channel-note">{note}</p>}
  </div>;
}
