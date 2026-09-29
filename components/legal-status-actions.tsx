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

function StatusSelect({endpoint,workspaceId,value,options}:{endpoint:string;workspaceId:string;value:string;options:string[][]}) {
  const router=useRouter();const [saving,setSaving]=useState(false);
  async function change(next:string){
    setSaving(true);
    const r=await fetch(endpoint,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({workspaceId,status:next})});
    setSaving(false); if(r.ok)router.refresh();
  }
  return <select className="status-select" value={value} disabled={saving} onChange={e=>change(e.target.value)}>{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>;
}

export function ContractStatusAction(props:{id:string;workspaceId:string;status:string}) {
  return <StatusSelect endpoint={"/api/contracts/"+props.id} workspaceId={props.workspaceId} value={props.status} options={contractOptions}/>;
}
export function DocumentStatusAction(props:{id:string;workspaceId:string;status:string}) {
  return <StatusSelect endpoint={"/api/documents/"+props.id} workspaceId={props.workspaceId} value={props.status} options={documentOptions}/>;
}
