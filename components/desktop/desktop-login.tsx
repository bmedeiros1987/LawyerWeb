"use client";
import { FormEvent, useState } from "react";
import { FileText, HardDrive, Layers3, ShieldCheck } from "lucide-react";
import { postJson } from "./native";
import "./desktop.css";

type Mode = "login" | "recover";

export function DesktopLogin({ hasAccounts }: { hasAccounts: boolean }) {
  const [mode, setMode] = useState<Mode>("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<{ key: string; next: string } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>, url: string, after: (d: Record<string, string>) => void) {
    e.preventDefault(); setBusy(true); setError("");
    const body = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try { after(await postJson<Record<string, string>>(url, body)); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  let card: React.ReactNode;
  if (recoveryKey) {
    card = <>
      <span className="eyebrow">Guarde esta chave</span><h2 id="login-heading">Chave de recuperação</h2>
      <p>Ela é a única forma de redefinir a senha da conta proprietária sem internet. Anote em papel ou num gerenciador de senhas. Ela não será mostrada de novo.</p>
      <div className="desktop-key" data-testid="recovery-key">{recoveryKey.key}</div>
      <div className="desktop-form"><button className="desktop-primary" onClick={() => { window.location.href = recoveryKey.next; }}>Anotei a chave · continuar</button></div>
    </>;
  } else if (!hasAccounts) {
    card = <>
      <span className="eyebrow">Primeiro acesso neste computador</span><h2 id="login-heading">Crie a conta<br/>proprietária.</h2>
      <p>Os dados ficam neste computador. O e-mail serve apenas como login local; nada é enviado pela internet.</p>
      <form className="desktop-form" onSubmit={e => submit(e, "/api/desktop/auth/setup", d => setRecoveryKey({ key: d.recoveryKey, next: d.next }))}>
        <label><span>Seu nome</span><input name="name" required maxLength={80} autoComplete="name"/></label>
        <label><span>E-mail (login)</span><input name="email" type="email" required autoComplete="username"/></label>
        <label><span>Senha (mínimo 12 caracteres)</span><input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>
        <label><span>Confirme a senha</span><input name="passwordConfirmation" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>
        {error && <div className="login-error" role="alert"><p>{error}</p></div>}
        <button className="desktop-primary" disabled={busy}>{busy ? "Criando…" : "Criar conta e entrar"}</button>
      </form>
    </>;
  } else if (mode === "recover") {
    card = <>
      <span className="eyebrow">Recuperar acesso</span><h2 id="login-heading">Redefinir a senha<br/>da conta proprietária.</h2>
      <p>Use a chave de recuperação mostrada quando a conta foi criada. Outras contas devem pedir à conta proprietária.</p>
      <form className="desktop-form" onSubmit={e => submit(e, "/api/desktop/auth/recover", d => setRecoveryKey({ key: d.recoveryKey, next: "/login" }))}>
        <label><span>E-mail</span><input name="email" type="email" required autoComplete="username"/></label>
        <label><span>Chave de recuperação</span><input name="recoveryKey" required autoComplete="off" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"/></label>
        <label><span>Nova senha</span><input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>
        <label><span>Confirme a nova senha</span><input name="passwordConfirmation" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>
        {error && <div className="login-error" role="alert"><p>{error}</p></div>}
        <button className="desktop-primary" disabled={busy}>{busy ? "Redefinindo…" : "Redefinir senha"}</button>
        <button type="button" className="desktop-link" onClick={() => { setMode("login"); setError(""); }}>Voltar para entrar</button>
      </form>
    </>;
  } else {
    card = <>
      <span className="eyebrow">Bem-vindo de volta</span><h2 id="login-heading">Seu escritório.<br/>Tudo no lugar.</h2>
      <p>Entre com a conta criada neste computador. Funciona sem internet.</p>
      <form className="desktop-form" onSubmit={e => submit(e, "/api/desktop/auth/login", d => { window.location.href = d.next; })}>
        <label><span>E-mail</span><input name="email" type="email" required autoComplete="username"/></label>
        <label><span>Senha</span><input name="password" type="password" required autoComplete="current-password"/></label>
        {error && <div className="login-error" role="alert"><p>{error}</p></div>}
        <button className="desktop-primary" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
        <button type="button" className="desktop-link" onClick={() => { setMode("recover"); setError(""); }}>Esqueci a senha</button>
      </form>
    </>;
  }

  return <main className="auth-page lawyermind-login">
    <section className="auth-visual" aria-label="LawyerMind">
      <div className="auth-brand"><div><strong className="lawyermind-wordmark">LawyerMind</strong><span>Seu trabalho jurídico, em ordem.</span></div></div>
      <div className="auth-copy"><span className="eyebrow">Clareza para o que importa</span><h1>Mais espaço<br/>para pensar.<br/><em>Mais controle<br/>para agir.</em></h1><p>Processos, clientes e documentos neste computador, com banco local e backup verificável.</p></div>
      <div className="auth-highlights"><span><HardDrive size={18} aria-hidden="true"/> Dados locais</span><span><Layers3 size={18} aria-hidden="true"/> Contexto reunido</span><span><FileText size={18} aria-hidden="true"/> Originais preservados</span></div>
    </section>
    <section className="auth-panel" aria-labelledby="login-heading">
      <div className="login-card">
        <div className="login-mobile-brand lawyermind-wordmark">LawyerMind</div>
        {card}
        <div className="login-meta"><ShieldCheck size={19} aria-hidden="true"/><span>Aplicativo desktop: banco PostgreSQL local, sem servidor remoto e sem conta Google.</span></div>
      </div>
      <footer className="brand-credit">LawyerMind Desktop · MBLZ</footer>
    </section>
  </main>;
}
