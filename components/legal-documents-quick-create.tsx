"use client";

import { FormEvent, useState } from "react";
import { FilePlus2, ScrollText } from "lucide-react";
import { useRouter } from "next/navigation";
import { QuickCreateShell } from "./quick-create-shell";

type ClientOption={id:string;name:string};
type MatterOption={id:string;label:string};
type MemberOption={userId:string;name:string};

function Shell({label,icon,children}:{label:string;icon:"contract"|"document";children:React.ReactNode}) {
  const Icon=icon==="contract"?ScrollText:FilePlus2;
  return <QuickCreateShell title={label} summary={<><Icon size={16}/>{label}</>}>{children}</QuickCreateShell>;
}

export function QuickContractForm({workspaceId,clients,matters,members}:{workspaceId:string;clients:ClientOption[];matters:MatterOption[];members:MemberOption[]}) {
  const router=useRouter(); const [saving,setSaving]=useState(false); const [error,setError]=useState("");
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setSaving(true);setError("");const fd=new FormData(e.currentTarget);
    const amountRaw=String(fd.get("amount")||"").replace(",",".");
    const noticeRaw=String(fd.get("noticeDays")||"");
    const effectiveAt=String(fd.get("effectiveAt")||"");
    const expiresAt=String(fd.get("expiresAt")||"");
    const body={
      workspaceId,title:fd.get("title"),contractType:fd.get("contractType"),
      clientId:fd.get("clientId")||undefined,matterId:fd.get("matterId")||undefined,
      counterparty:fd.get("counterparty")||undefined,status:fd.get("status"),
      responsibleUserId:fd.get("responsibleUserId")||undefined,
      effectiveAt:effectiveAt?new Date(effectiveAt).toISOString():undefined,
      expiresAt:expiresAt?new Date(expiresAt).toISOString():undefined,
      noticeDays:noticeRaw?Number(noticeRaw):undefined,autoRenew:fd.get("autoRenew")==="on",
      amount:amountRaw?Number(amountRaw):undefined,currency:"BRL",
    };
    const r=await fetch("/api/contracts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    const data=await r.json().catch(()=>({}));
    if(!r.ok){setError(data?.error??"Não foi possível cadastrar o contrato.");setSaving(false);return}
    e.currentTarget.reset();setSaving(false);router.push("/app/contratos/"+data.contract.id);router.refresh();
  }
  return <Shell label="Novo contrato" icon="contract"><form className="quick-form" onSubmit={submit}>
    <label><span>Nome do contrato</span><input name="title" required minLength={2} placeholder="Ex.: Prestação de serviços — Cliente X"/></label>
    <div className="quick-form-grid">
      <label><span>Tipo</span><input name="contractType" required placeholder="Prestação de serviços, locação, NDA…"/></label>
      <label><span>Status</span><select name="status" defaultValue="DRAFT"><option value="DRAFT">Minuta</option><option value="NEGOTIATION">Negociação</option><option value="REVIEW">Revisão</option><option value="SIGNING">Assinatura</option><option value="ACTIVE">Ativo</option></select></label>
    </div>
    <div className="quick-form-grid">
      <label><span>Cliente</span><select name="clientId" defaultValue=""><option value="">Sem vínculo</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label><span>Contraparte</span><input name="counterparty" placeholder="Opcional"/></label>
    </div>
    <label><span>Processo / assunto</span><select name="matterId" defaultValue=""><option value="">Sem processo</option>{matters.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    <div className="quick-form-grid">
      <label><span>Início da vigência</span><input name="effectiveAt" type="date"/></label>
      <label><span>Fim da vigência</span><input name="expiresAt" type="date"/></label>
    </div>
    <div className="quick-form-grid">
      <label><span>Aviso prévio (dias)</span><input name="noticeDays" type="number" min="0" max="3650" placeholder="30"/></label>
      <label><span>Valor</span><input name="amount" inputMode="decimal" placeholder="0,00"/></label>
    </div>
    <label><span>Responsável</span><select name="responsibleUserId" defaultValue=""><option value="">Eu</option>{members.map(m=><option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
    <label className="check-line"><input type="checkbox" name="autoRenew"/><span>Renovação automática prevista</span></label>
    {error&&<p className="form-error">{error}</p>}
    <button className="form-submit" disabled={saving}>{saving?"Salvando…":"Cadastrar contrato"}</button>
  </form></Shell>
}

export function QuickLegalDocumentForm({workspaceId,clients,matters}:{workspaceId:string;clients:ClientOption[];matters:MatterOption[]}) {
  const router=useRouter(); const [saving,setSaving]=useState(false); const [error,setError]=useState("");
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setSaving(true);setError("");const fd=new FormData(e.currentTarget);
    const body={workspaceId,name:fd.get("name"),kind:fd.get("kind"),status:fd.get("status"),clientId:fd.get("clientId")||undefined,matterId:fd.get("matterId")||undefined};
    const r=await fetch("/api/documents",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    const data=await r.json().catch(()=>({}));
    if(!r.ok){setError(data?.error??"Não foi possível criar o documento.");setSaving(false);return}
    e.currentTarget.reset();setSaving(false);router.push("/app/documentos/"+data.document.id);router.refresh();
  }
  return <Shell label="Novo documento" icon="document"><form className="quick-form" onSubmit={submit}>
    <label><span>Nome</span><input name="name" required minLength={2} placeholder="Ex.: Parecer jurídico — contratação"/></label>
    <div className="quick-form-grid">
      <label><span>Tipo</span><select name="kind" defaultValue="OPINION"><option value="CONTRACT">Contrato</option><option value="OPINION">Parecer</option><option value="POWER_OF_ATTORNEY">Procuração</option><option value="CERTIFICATE">Certidão</option><option value="CORPORATE_ACT">Ato societário</option><option value="TRADEMARK_PATENT">Marca / patente</option><option value="PETITION">Petição</option><option value="NOTICE">Notificação</option><option value="MINUTES">Ata</option><option value="OTHER">Outro</option></select></label>
      <label><span>Status</span><select name="status" defaultValue="DRAFT"><option value="DRAFT">Minuta</option><option value="IN_REVIEW">Em revisão</option><option value="APPROVED">Aprovado</option><option value="SIGNING">Assinatura</option><option value="SIGNED">Assinado</option><option value="ARCHIVED">Arquivado</option></select></label>
    </div>
    <label><span>Cliente</span><select name="clientId" defaultValue=""><option value="">Sem vínculo</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label><span>Processo / assunto</span><select name="matterId" defaultValue=""><option value="">Sem processo</option>{matters.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    <p className="form-hint">O registro jurídico é criado agora. O arquivo e suas versões serão anexados quando o storage seguro estiver habilitado.</p>
    {error&&<p className="form-error">{error}</p>}
    <button className="form-submit" disabled={saving}>{saving?"Salvando…":"Criar registro"}</button>
  </form></Shell>
}
