"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Building2, ShieldCheck } from "lucide-react";

export function WorkspaceSetupForm() {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle"|"saving"|"error">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length < 2) return;
    setStatus("saving");
    setError("");
    const response = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), timezone: "America/Sao_Paulo" }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body?.error ?? "Não foi possível criar o workspace.");
      setStatus("error");
      return;
    }
    window.location.assign("/app");
  }

  return <form className="setup-form" onSubmit={submit}>
    <label>
      <span>Nome do escritório ou departamento jurídico</span>
      <div className="setup-input">
        <Building2 size={18}/>
        <input
          autoFocus
          value={name}
          onChange={(e)=>setName(e.target.value)}
          placeholder="Ex.: Escritório Silva & Associados"
          maxLength={120}
          required
        />
      </div>
    </label>
    <div className="setup-assurance"><ShieldCheck size={16}/><span>Você será criado como Proprietário e poderá convidar a equipe depois.</span></div>
    {error && <p className="setup-error">{error}</p>}
    <button className="setup-submit" disabled={status==="saving" || name.trim().length<2}>
      {status==="saving"?"Criando workspace…":"Criar meu workspace"}<ArrowRight size={17}/>
    </button>
  </form>;
}
