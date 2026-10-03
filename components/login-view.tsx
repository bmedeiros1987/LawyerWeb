"use client";

import { useFormStatus } from "react-dom";
import { ArrowRight, FileText, Layers3, ShieldCheck } from "lucide-react";

function SignInButton() {
  const { pending } = useFormStatus();
  return <button className="google-button" disabled={pending} aria-busy={pending}>
    <span className="google-g" aria-hidden="true">G</span>
    <span>{pending ? "Abrindo acesso seguro…" : "Continuar com Google"}</span>
    <ArrowRight size={17} aria-hidden="true"/>
  </button>;
}

export function LoginView({ action, error }: { action: () => Promise<void>; error?: string }) {
  return <main className="auth-page lawyermind-login">
    <section className="auth-visual" aria-label="LawyerMind">
      <div className="auth-brand"><div><strong className="lawyermind-wordmark">LawyerMind</strong><span>Seu trabalho jurídico, em ordem.</span></div></div>
      <div className="auth-copy"><span className="eyebrow">Clareza para o que importa</span><h1>Mais espaço<br/>para pensar.<br/><em>Mais controle<br/>para agir.</em></h1><p>Do primeiro rascunho à próxima decisão: organize processos, acompanhe prazos e encontre o contexto de cada documento.</p></div>
      <div className="auth-highlights"><span><Layers3 size={18} aria-hidden="true"/> Contexto reunido</span><span><FileText size={18} aria-hidden="true"/> Histórico preservado</span></div>
    </section>
    <section className="auth-panel" aria-labelledby="login-heading">
      <div className="login-card">
        <div className="login-mobile-brand lawyermind-wordmark">LawyerMind</div>
        <span className="eyebrow">Bem-vindo de volta</span><h2 id="login-heading">Seu escritório.<br/>Tudo no lugar.</h2>
        <p>Entre para continuar seu trabalho com os documentos e processos do seu workspace.</p>
        {error && <div className="login-error" role="alert"><strong>Não foi possível entrar</strong><p>{error}</p></div>}
        <form action={action}><SignInButton/></form>
        <p className="login-provider-note">O acesso por e-mail e senha ainda não está disponível. O acesso existente pelo Google permanece funcionando.</p>
        <div className="login-meta"><ShieldCheck size={19} aria-hidden="true"/><span>Entrar não conecta sua agenda. A permissão do Calendar é solicitada separadamente, se você optar por usá-lo.</span></div>
      </div>
      <footer className="brand-credit">Desenvolvido por MBLZ, uma empresa CrewCheck</footer>
    </section>
  </main>;
}
