"use client";

import { FormEvent, useState } from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { QuickCreateShell } from "./quick-create-shell";

function DialogShell({title,children}:{title:string;children:React.ReactNode}) {
  return <QuickCreateShell title={title} summary={<><Plus size={16}/>{title}</>}>{children}</QuickCreateShell>;
}

function ErrorLine({message}:{message:string}) {
  return message ? <p className="form-error">{message}</p> : null;
}

export function QuickClientForm({workspaceId}:{workspaceId:string}) {
  const router=useRouter(); const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); setSaving(true); setError("");
    const fd=new FormData(e.currentTarget);
    const body={workspaceId,type:fd.get("type"),name:fd.get("name"),cpfCnpj:fd.get("cpfCnpj"),email:fd.get("email"),phone:fd.get("phone")};
    const r=await fetch("/api/clients",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    const data=await r.json().catch(()=>({}));
    if(!r.ok){setError(data?.error??"Não foi possível cadastrar.");setSaving(false);return}
    e.currentTarget.reset(); setSaving(false); router.refresh();
  }
  return <DialogShell title="Novo cliente"><form className="quick-form" onSubmit={submit}>
    <label><span>Tipo</span><select name="type" defaultValue="LEGAL_ENTITY"><option value="LEGAL_ENTITY">Pessoa jurídica</option><option value="INDIVIDUAL">Pessoa física</option></select></label>
    <label><span>Nome</span><input name="name" required minLength={2} placeholder="Nome ou razão de uso"/></label>
    <div className="quick-form-grid"><label><span>CPF/CNPJ</span><input name="cpfCnpj" placeholder="Opcional"/></label><label><span>Telefone</span><input name="phone" placeholder="Opcional"/></label></div>
    <label><span>E-mail</span><input name="email" type="email" placeholder="Opcional"/></label>
    <ErrorLine message={error}/><button className="form-submit" disabled={saving}>{saving?"Salvando…":"Cadastrar cliente"}</button>
  </form></DialogShell>
}

export function QuickMatterForm({workspaceId,clients,members}:{workspaceId:string;clients:{id:string;name:string}[];members:{userId:string;name:string}[]}) {
  const router=useRouter(); const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setSaving(true);setError("");const fd=new FormData(e.currentTarget);
    const body={workspaceId,clientId:fd.get("clientId")||undefined,number:fd.get("number")||undefined,internalCode:fd.get("internalCode")||undefined,title:fd.get("title"),practiceArea:fd.get("practiceArea")||undefined,court:fd.get("court")||undefined,courtUnit:fd.get("courtUnit")||undefined,responsibleUserId:fd.get("responsibleUserId")||undefined,secrecy:fd.get("secrecy")==="on"};
    const r=await fetch("/api/matters",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const data=await r.json().catch(()=>({}));
    if(!r.ok){setError(data?.error??"Não foi possível cadastrar.");setSaving(false);return}
    e.currentTarget.reset();setSaving(false);router.push(`/app/processos/${data.matter.id}`);router.refresh();
  }
  return <DialogShell title="Novo processo"><form className="quick-form" onSubmit={submit}>
    <div className="quick-form-grid"><label><span>Nº CNJ</span><input name="number" placeholder="0000000-00.0000.0.00.0000"/></label><label><span>Pasta interna</span><input name="internalCode" placeholder="Opcional"/></label></div>
    <label><span>Assunto / nome da pasta</span><input name="title" required minLength={2}/></label>
    <label><span>Cliente</span><select name="clientId" defaultValue=""><option value="">Sem vínculo</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <div className="quick-form-grid"><label><span>Área</span><input name="practiceArea" placeholder="Cível, trabalhista…"/></label><label><span>Responsável</span><select name="responsibleUserId" defaultValue=""><option value="">Eu</option>{members.map(m=><option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label></div>
    <div className="quick-form-grid"><label><span>Tribunal</span><input name="court"/></label><label><span>Órgão / Vara</span><input name="courtUnit"/></label></div>
    <label className="check-line"><input name="secrecy" type="checkbox"/><span>Processo sigiloso — acesso explícito por usuário</span></label>
    <ErrorLine message={error}/><button className="form-submit" disabled={saving}>{saving?"Salvando…":"Cadastrar processo"}</button>
  </form></DialogShell>
}

export function QuickTaskForm({workspaceId,matters,members}:{workspaceId:string;matters:{id:string;label:string}[];members:{userId:string;name:string}[]}) {
  const router=useRouter();const [error,setError]=useState("");const [saving,setSaving]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setSaving(true);setError("");const fd=new FormData(e.currentTarget);
    const due=String(fd.get("dueAt")||"");
    const body={workspaceId,matterId:fd.get("matterId")||undefined,title:fd.get("title"),description:fd.get("description")||undefined,priority:fd.get("priority"),assigneeUserId:fd.get("assigneeUserId")||undefined,reviewerUserId:fd.get("reviewerUserId")||undefined,dueAt:due?new Date(due).toISOString():undefined,private:fd.get("private")==="on"};
    const r=await fetch("/api/tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const data=await r.json().catch(()=>({}));
    if(!r.ok){setError(data?.error??"Não foi possível criar a tarefa.");setSaving(false);return}
    e.currentTarget.reset();setSaving(false);router.refresh();
  }
  return <DialogShell title="Nova tarefa"><form className="quick-form" onSubmit={submit}>
    <label><span>Tarefa</span><input name="title" required minLength={2} placeholder="O que precisa ser feito?"/></label>
    <label><span>Descrição</span><textarea name="description" rows={3}/></label>
    <label><span>Processo / assunto</span><select name="matterId" defaultValue=""><option value="">Sem vínculo</option>{matters.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    <div className="quick-form-grid"><label><span>Encarregado</span><select name="assigneeUserId" defaultValue=""><option value="">Eu</option>{members.map(m=><option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label><label><span>Revisor</span><select name="reviewerUserId" defaultValue=""><option value="">Sem revisor</option>{members.map(m=><option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label></div>
    <div className="quick-form-grid"><label><span>Prazo interno</span><input name="dueAt" type="datetime-local"/></label><label><span>Prioridade</span><select name="priority" defaultValue="NORMAL"><option value="LOW">Baixa</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></label></div>
    <label className="check-line"><input name="private" type="checkbox"/><span>Privada — visível apenas para envolvidos</span></label>
    <ErrorLine message={error}/><button className="form-submit" disabled={saving}>{saving?"Salvando…":"Criar tarefa"}</button>
  </form></DialogShell>
}
