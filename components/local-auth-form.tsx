"use client";
import { useState, type FormEvent } from "react";

export function LocalAuthForm() {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [busy, setBusy] = useState(false), [show, setShow] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/auth/local/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.get("email"), ...(mode === "login" ? { password: data.get("password") } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível concluir. Tente novamente.");
      if (mode === "login") { window.location.assign("/app"); return; }
      setMessage(result.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível conectar. Tente novamente."); }
    finally { setBusy(false); }
  }
  return <section className="local-auth" aria-label="Acesso por e-mail e senha">
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label>E-mail<input name="email" type="email" autoComplete="email" required maxLength={254}/></label>
      {mode === "login" ? <label>Senha<div className="password-field"><input name="password" type={show ? "text" : "password"} autoComplete="current-password" required maxLength={128}/><button type="button" aria-pressed={show} onClick={() => setShow(!show)}>{show ? "Ocultar" : "Mostrar"}</button></div></label> : <p>{mode === "register" ? "Confirme seu e-mail para criar uma conta e escolher sua senha." : "Enviaremos um link para redefinir a senha de uma conta com acesso por senha."}</p>}
      <button className="button primary" type="submit" aria-busy={busy}>{busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Enviar link por e-mail"}</button>
      <div className="local-auth-links">{(["login", "register", "reset"] as const).filter(value => value !== mode).map(value => <button type="button" key={value} onClick={() => { setMode(value); setMessage(""); setError(""); }}>{value === "login" ? "Voltar para entrar" : value === "register" ? "Criar conta" : "Esqueci minha senha"}</button>)}</div>
    </fieldset></form>
    {error && <p role="alert" className="login-error">{error}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
