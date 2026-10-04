"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
export function PasswordVerification() {
  const initialized = useRef(false);
  const [link, setLink] = useState<{ token: string; purpose: "REGISTER" | "RESET" } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(false), [show, setShow] = useState(false);
  useEffect(() => {
    if (initialized.current) return; initialized.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("token") ?? "", purpose = params.get("purpose");
    window.history.replaceState(null, "", window.location.pathname);
    if (/^[A-Za-z0-9_-]{43}$/.test(token) && (purpose === "REGISTER" || purpose === "RESET")) setLink({ token, purpose });
    else setError("Link inválido. Solicite um novo link para definir sua senha.");
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !link) return;
    const form = new FormData(event.currentTarget), password = String(form.get("password")), passwordConfirmation = String(form.get("passwordConfirmation"));
    if (password !== passwordConfirmation) { setError("As senhas devem ser iguais."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/local/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...link, password, passwordConfirmation, ...(link.purpose === "REGISTER" ? { name: form.get("name") } : {}) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Não foi possível definir a senha.");
      setLink(null); setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível conectar. Tente novamente."); } finally { setBusy(false); }
  }
  return <section className="local-auth"><h2>{done ? "Senha definida" : "Escolha sua senha"}</h2>
    {done ? <p role="status">Entre com seu e-mail e sua nova senha.</p> : link && <form onSubmit={submit}><fieldset disabled={busy}>
      {link.purpose === "REGISTER" && <label>Seu nome<input name="name" autoComplete="name" required maxLength={80}/></label>}
      <label>Nova senha<input name="password" type={show ? "text" : "password"} autoComplete="new-password" required minLength={12} maxLength={128}/></label>
      <label>Repita a senha<input name="passwordConfirmation" type={show ? "text" : "password"} autoComplete="new-password" required minLength={12} maxLength={128}/></label>
      <button type="button" aria-pressed={show} onClick={() => setShow(!show)}>{show ? "Ocultar senhas" : "Mostrar senhas"}</button><p>Use entre 12 e 128 caracteres. O link é válido por 15 minutos e pode ser usado uma vez.</p>
      <button className="button primary" type="submit" aria-busy={busy}>{busy ? "Salvando…" : "Salvar senha"}</button>
    </fieldset></form>}
    {error && <p role="alert" className="login-error">{error}</p>}<a href="/login">Voltar para entrar</a>
  </section>;
}
