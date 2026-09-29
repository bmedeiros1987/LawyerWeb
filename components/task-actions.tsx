"use client";

import { Check, MoreHorizontal, Play, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function TaskActions({id,workspaceId,status}:{id:string;workspaceId:string;status:string}) {
  const router=useRouter();
  const [busy,setBusy]=useState(false);

  async function setStatus(next:string) {
    setBusy(true);
    const response=await fetch("/api/tasks/"+id,{
      method:"PATCH",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({workspaceId,status:next}),
    });
    setBusy(false);
    if(response.ok) router.refresh();
  }

  if(status==="DONE") return <button className="row-action" disabled={busy} onClick={()=>setStatus("OPEN")} title="Reabrir"><RotateCcw size={15}/></button>;
  if(status==="OPEN") return <button className="row-action" disabled={busy} onClick={()=>setStatus("IN_PROGRESS")} title="Iniciar"><Play size={15}/></button>;
  return <div className="task-actions"><button className="row-action" disabled={busy} onClick={()=>setStatus("DONE")} title="Concluir"><Check size={15}/></button><button className="row-action" disabled={busy} onClick={()=>setStatus("OPEN")} title="Voltar para aberta"><MoreHorizontal size={15}/></button></div>;
}
