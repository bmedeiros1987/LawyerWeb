import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";

export default function Home() {
  return <main className="landing-page">
    <nav className="landing-nav">
      <div className="landing-brand">
        <img src="/brand/lawyermind-app-icon.png" alt="LawyerMind"/>
        <div><strong>LawyerMind</strong><span>Gestão jurídica</span></div>
      </div>
      <div className="landing-nav-actions">
        <Link className="landing-ghost" href="/preview">Ver demonstração</Link>
        <Link className="landing-primary" href="/login">Entrar <ArrowRight size={15}/></Link>
      </div>
    </nav>

    <section className="landing-hero">
      <div className="landing-copy">
        <span className="eyebrow">LawyerMind</span>
        <h1>O jurídico,<br/><em>sem ruído.</em></h1>
        <p>Processos, prazos, contratos, documentos, agenda e inteligência jurídica reunidos em uma experiência simples, rastreável e construída para o trabalho real.</p>
        <div className="landing-cta">
          <Link className="landing-primary large" href="/preview">Explorar demonstração <ArrowRight size={16}/></Link>
          <span><ShieldCheck size={15}/> Ambiente de demonstração sem dados reais</span>
        </div>
      </div>

      <div className="landing-visual">
        <div className="landing-orb"><img src="/brand/lawyermind-symbol-cream.png" alt="Símbolo LawyerMind"/></div>
        <article className="landing-float one">
          <span className="landing-dot critical"/>
          <div><small>Deadline Safety</small><strong>Prazo crítico identificado</strong></div>
        </article>
        <article className="landing-float two">
          <Sparkles size={18}/>
          <div><small>LawyerMind Intelligence</small><strong>Revisão com contexto e fontes</strong></div>
        </article>
        <article className="landing-float three">
          <CheckCircle2 size={18}/>
          <div><small>Operação</small><strong>Responsável e revisor definidos</strong></div>
        </article>
      </div>
    </section>

    <section className="landing-pillars">
      <article><strong>Prazo não passa sozinho.</strong><span>Confirmação humana, responsável, revisor, prazo interno, alertas e escalonamento.</span></article>
      <article><strong>O processo vira prontuário.</strong><span>Comunicações, tarefas, documentos, agenda e histórico numa única linha do tempo.</span></article>
      <article><strong>IA dentro do fluxo.</strong><span>Revisão, resumo, comparação e pesquisa jurídica com rastreabilidade e controle humano.</span></article>
    </section>

    <footer className="landing-footer">
      <span>Desenvolvido por <strong>Bruno & Marina Tecnologia</strong></span>
      <span>Staging privado em evolução</span>
    </footer>
  </main>;
}
