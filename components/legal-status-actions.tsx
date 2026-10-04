"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const contractOptions=[
  ["DRAFT","Minuta"],["NEGOTIATION","Negociação"],["REVIEW","Revisão"],["SIGNING","Assinatura"],
  ["ACTIVE","Ativo"],["EXPIRING","Vencendo"],["EXPIRED","Vencido"],["TERMINATED","Encerrado"],["ARCHIVED","Arquivado"],
];
const documentOptions=[
  ["DRAFT","Minuta"],["IN_REVIEW","Em revisão"],["APPROVED","Aprovado"],["SIGNING","Assinatura"],["SIGNED","Assinado"],["ARCHIVED","Arquivado"],
];

function StatusSelect({endpoint,workspaceId,value,options,expectedVersion}:{endpoint:string;workspaceId:string;value:string;options:string[][];expectedVersion?:number}) {
  const router=useRouter();const [saving,setSaving]=useState(false);const [error,setError]=useState("");
  async function change(next:string){
    setSaving(true);setError("");
    try {
      const r=await fetch(endpoint,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({workspaceId,status:next,expectedVersion})});
      const data=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(data.error??"Não foi possível alterar o status.");
      router.refresh();
    } catch(error){setError(error instanceof Error?error.message:"Não foi possível alterar o status.");}
    finally {setSaving(false);}
  }
  return <div><select aria-label="Status do documento ou contrato" className="status-select" value={value} disabled={saving} onChange={e=>change(e.target.value)}>{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>{error&&<p role="alert" className="form-error">{error}</p>}</div>;
}

export function ContractStatusAction(props:{id:string;workspaceId:string;status:string}) {
  return <StatusSelect endpoint={"/api/contracts/"+props.id} workspaceId={props.workspaceId} value={props.status} options={contractOptions}/>;
}
export function DocumentStatusAction(props:{id:string;workspaceId:string;status:string;currentVersion:number}) {
  return <StatusSelect endpoint={"/api/documents/"+props.id} workspaceId={props.workspaceId} value={props.status} options={documentOptions} expectedVersion={props.currentVersion}/>;
}
