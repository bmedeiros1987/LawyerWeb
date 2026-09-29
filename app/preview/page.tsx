import Link from "next/link";
import {
  BellRing, BriefcaseBusiness, CalendarDays, CheckCircle2, ChevronRight,
  Clock3, FileText, Gavel, Landmark, LayoutDashboard, Scale, Search,
  ShieldCheck, Sparkles, UsersRound, ScrollText
} from "lucide-react";

const nav=[
  ["Pulse",LayoutDashboard],
  ["Caixa Jurídica",BellRing],
  ["Prazos",Clock3],
  ["Processos",BriefcaseBusiness],
  ["Clientes",UsersRound],
  ["Agenda",CalendarDays],
  ["Documentos",FileText],
  ["Contratos",ScrollText],
] as const;

const matters=[
  ["0708421-19.2026.8.07.0001","Alvorada Participações","Contestação","Atenção"],
  ["0001389-44.2026.5.10.0007","Grupo Horizonte","Audiência designada","Em dia"],
  ["1029844-71.2025.8.26.0100","Nexo Empreendimentos","Aguardando decisão","Em dia"],
];

export default function PreviewPage(){
  return <div className="preview-shell">
    <aside className="preview-sidebar">
      <div className="preview-brand">
        <img src="/brand/mblz-app-icon.svg" alt="MBLZ"/>
        <div><strong>MBLZ</strong><span>Legal OS</span></div>
      </div>

      <button className="preview-search"><Search size={16}/><span>Buscar em tudo</span><kbd>⌘ K</kbd></button>

      <nav>
        <small>Operação</small>
        {nav.map(([label,Icon],i)=>
          <div key={label} className={i===0?"preview-nav active":"preview-nav"}>
            <Icon size={18}/><span>{label}</span>{i===0&&<i/>}
          </div>
        )}
      </nav>

      <div className="preview-sidebar-bottom">
        <ShieldCheck size={17}/>
        <div><strong>Proteção de prazos</strong><span>Ativa</span></div>
        <i/>
      </div>
    </aside>

    <main className="preview-main">
      <header className="preview-topbar">
        <div>
          <span>Workspace</span>
          <strong>Escritório Modelo — Demo</strong>
        </div>
        <div className="preview-top-actions">
          <button><BellRing size={17}/></button>
          <div className="preview-avatar">BM</div>
        </div>
      </header>

      <div className="preview-content">
        <section className="preview-demo-note">
          <div><Sparkles size={15}/><strong>Prévia pública do produto</strong><span>Dados fictícios — nenhuma informação real de cliente é exibida.</span></div>
          <Link href="/">Sair da prévia</Link>
        </section>

        <section className="preview-hero">
          <div>
            <span className="eyebrow">Terça-feira, 29 de setembro</span>
            <h1>O que precisa da sua atenção.</h1>
            <p>O MBLZ prioriza risco, contexto e próxima ação — não quantidade de telas.</p>
          </div>
          <button className="preview-ai-button"><Sparkles size={16}/>Perguntar ao MBLZ</button>
        </section>

        <section className="preview-metrics">
          <article className="preview-metric danger">
            <div><Clock3 size={18}/></div><span>Prazos críticos</span><strong>1</strong><small>exige ação hoje</small>
          </article>
          <article className="preview-metric">
            <div><Gavel size={18}/></div><span>Novas comunicações</span><strong>12</strong><small>DJEN + tribunais</small>
          </article>
          <article className="preview-metric">
            <div><CalendarDays size={18}/></div><span>Agenda de hoje</span><strong>4</strong><small>audiências e reuniões</small>
          </article>
          <article className="preview-metric">
            <div><CheckCircle2 size={18}/></div><span>Equipe sob controle</span><strong>94%</strong><small>tarefas em dia</small>
          </article>
        </section>

        <section className="preview-grid">
          <article className="preview-card wide">
            <div className="preview-card-head">
              <div><span className="eyebrow">MBLZ Pulse</span><h2>Prioridades agora</h2></div>
              <button>Ver Caixa Jurídica <ChevronRight size={14}/></button>
            </div>

            <div className="preview-pulse-row critical">
              <div className="preview-pulse-icon"><Clock3 size={18}/></div>
              <div><strong>Prazo fatal amanhã</strong><span>Contestação · prazo interno hoje às 17:00</span></div>
              <b>Crítico</b>
            </div>
            <div className="preview-pulse-row">
              <div className="preview-pulse-icon"><Gavel size={18}/></div>
              <div><strong>Nova intimação detectada</strong><span>Prazo candidato aguardando confirmação humana</span></div>
              <b className="review">Revisar</b>
            </div>
            <div className="preview-pulse-row">
              <div className="preview-pulse-icon"><FileText size={18}/></div>
              <div><strong>Contrato recebeu nova versão</strong><span>Prestação de serviços · contraparte alterou 4 cláusulas</span></div>
              <b className="quiet">Documento</b>
            </div>
          </article>

          <aside className="preview-card preview-intelligence">
            <div className="preview-ai-orb"><Sparkles size={22}/></div>
            <span className="eyebrow">MBLZ Intelligence</span>
            <h2>Briefing jurídico, pronto.</h2>
            <p>Resumos, comparação de versões, revisão contratual e próximas ações usando somente o contexto autorizado do escritório.</p>
            <button>Abrir Intelligence</button>
          </aside>
        </section>

        <section className="preview-card">
          <div className="preview-card-head">
            <div><span className="eyebrow">Contencioso</span><h2>Processos em destaque</h2></div>
            <button>Novo processo</button>
          </div>
          <div className="preview-table">
            <div className="preview-tr head"><span>Processo</span><span>Cliente</span><span>Último movimento</span><span>Status</span></div>
            {matters.map(([num,client,last,status])=>
              <div className="preview-tr" key={num}>
                <div className="preview-process"><span><BriefcaseBusiness size={16}/></span><div><strong>{num}</strong><small>Contencioso</small></div></div>
                <span>{client}</span><span>{last}</span>
                <span className={status==="Atenção"?"preview-status attention":"preview-status"}>{status}</span>
              </div>
            )}
          </div>
        </section>

        <section className="preview-three">
          <article className="preview-card compact">
            <div className="preview-mini-icon"><Scale size={19}/></div>
            <span className="eyebrow">Contratos</span>
            <h3>Revisão inteligente</h3>
            <p>Comparação de versões, cláusulas críticas, vigência, aviso prévio e playbooks do escritório.</p>
          </article>
          <article className="preview-card compact">
            <div className="preview-mini-icon"><Landmark size={19}/></div>
            <span className="eyebrow">Financeiro</span>
            <h3>Ligado ao trabalho</h3>
            <p>Honorários, despesas, horas e resultado por cliente e assunto — sem virar sistema contábil.</p>
          </article>
          <article className="preview-card compact">
            <div className="preview-mini-icon"><ShieldCheck size={19}/></div>
            <span className="eyebrow">Deadline Safety</span>
            <h3>Prazo não passa sozinho.</h3>
            <p>Responsável, revisor, prazo interno, alertas e escalonamento para reduzir risco operacional.</p>
          </article>
        </section>

        <footer className="preview-footer">Desenvolvido por <strong>Bruno & Marina Tecnologia</strong></footer>
      </div>
    </main>
  </div>
}
