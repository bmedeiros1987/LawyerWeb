import { BellRing, Bot, CalendarDays, CheckCircle2, Cloud, ExternalLink, Mail, RefreshCw } from "lucide-react";
import { PushOptIn } from "@/components/push-opt-in";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { openClawConnectionState } from "@/lib/agent/connection-state";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth();
  const userId = session?.user?.id;
  const [calendar, membership] = userId ? await Promise.all([
    prisma.googleCalendarConnection.findUnique({ where: { userId } }),
    prisma.workspaceMember.findFirst({
      where: { userId, status: "ACTIVE" },
      include: { workspace: true },
      orderBy: { createdAt: "asc" },
    }),
  ]) : [null, null];

  const gmail = userId && membership
    ? await prisma.googleGmailConnection.findUnique({ where: { workspaceId_userId: { workspaceId: membership.workspaceId, userId } } })
    : null;
  const openClaw = membership
    ? await prisma.openClawConnection.findUnique({ where: { workspaceId: membership.workspaceId } })
    : null;
  const openClawState = openClawConnectionState(openClaw);
  const lastCourtPush = membership
    ? await prisma.courtCommunication.findFirst({
        where: { workspaceId: membership.workspaceId, source: "DATAJUD" },
        select: { receivedAt: true },
        orderBy: { receivedAt: "desc" },
      })
    : null;
  const lastCourtPushLabel = lastCourtPush?.receivedAt.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: membership?.workspace.timezone ?? "America/Sao_Paulo",
  });

  return <div className="page-stack">
    <section className="page-header">
      <div><span className="eyebrow">Conectividade</span><h1>Integrações</h1><p>Serviços da rotina com permissões mínimas e trilha de auditoria.</p></div>
    </section>

    <section className="integration-list">
      <article className="integration-card">
        <div className="integration-logo">G</div>
        <div><strong>Google Calendar</strong><span>{calendar ? "Conectado" : "Agenda MBLZ dedicada, sincronização bidirecional e webhook."}</span></div>
        {calendar
          ? <form action="/api/integrations/google-calendar/disconnect" method="post"><button className="danger-button">Desconectar</button></form>
          : <a className="new-button" href="/api/integrations/google-calendar/connect"><CalendarDays size={15}/>Conectar</a>}
      </article>

      <article className="integration-card">
        <div className="integration-logo" style={{ color: "#c44755" }}><Mail size={20}/></div>
        <div>
          <strong>Gmail → Caixa Jurídica</strong>
          <span>{gmail ? `Conectado como ${gmail.googleEmail}` : membership ? "Novos e-mails viram demandas candidatas para triagem." : "Crie primeiro o workspace do escritório."}</span>
        </div>
        {gmail && membership
          ? <form action="/api/integrations/google-gmail/disconnect" method="post">
              <input type="hidden" name="workspaceId" value={membership.workspaceId}/>
              <button className="danger-button">Desconectar</button>
            </form>
          : membership
            ? <a className="new-button" href={`/api/integrations/google-gmail/connect?workspaceId=${membership.workspaceId}`}><Mail size={15}/>Conectar</a>
            : <span className="status-pill quiet">Aguardando setup</span>}
      </article>

      <article className="integration-card">
        <div className="integration-logo" style={{color:"#655cf6"}}><Bot size={20}/></div>
        <div><strong>MBLZ Agent · OpenClaw</strong><span>{openClawState === "CONNECTED" ? "Gateway conectado. Configure seus canais e teste o agente." : openClawState === "DEGRADED" ? "Não conectado: existe uma configuração, mas o Gateway não está com status conectado. Revise a conexão." : "Não conectado. Agente próprio com e-mail, Telegram, WhatsApp e Web em uma única camada."}</span></div>
        {membership
          ? <a className="new-button" href="/app/integrations/openclaw"><Bot size={15}/>{openClawState === "CONNECTED" ? "Configurar" : openClawState === "DEGRADED" ? "Revisar" : "Preparar"}</a>
          : <span className="status-pill quiet">Aguardando setup</span>}
      </article>

      <article className="integration-card">
        <div className="integration-logo" style={{color:"#655cf6"}}><BellRing size={20}/></div>
        <div><strong>Notificações do dispositivo</strong><span>Prazos críticos, escalonamentos e atualizações importantes no PWA.</span></div>
        <PushOptIn/>
      </article>

      <article className="integration-card">
        <div className="integration-logo" style={{color:"#59616d"}}><Cloud size={19}/></div>
        <div>
          <strong>MBLZ Push — Tribunais</strong>
          <span>
            DataJud público em modo leitura: movimentações entram na Caixa Jurídica para revisão e nunca confirmam prazo automaticamente.
            {lastCourtPushLabel ? ` Última entrada capturada: ${lastCourtPushLabel}.` : " Nenhuma entrada DataJud foi capturada neste workspace ainda."}
            {" "}DJEN e Domicílio Judicial exigem integração oficial separada.
          </span>
        </div>
        {membership
          ? <form action="/api/integrations/court-push/refresh" method="post">
              <button className="new-button"><RefreshCw size={15}/>Atualizar DataJud</button>
            </form>
          : <span className="status-pill quiet">Aguardando setup</span>}
      </article>

      <article className="integration-card">
        <div className="integration-logo" style={{color:"#2a8a64"}}><CheckCircle2 size={20}/></div>
        <div><strong>Google Login</strong><span>OpenID Connect separado das permissões de Calendar e Gmail.</span></div>
        <span className="status-pill success">Ativo</span>
      </article>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><span className="eyebrow">Segurança</span><h2>Permissão mínima, contexto máximo.</h2></div><ExternalLink size={16}/></div>
      <p style={{margin:0,color:"#737b88",fontSize:11,lineHeight:1.7}}>Calendar e Gmail são consentimentos separados. Tokens ficam criptografados e podem ser revogados pelo usuário.</p>
    </section>
  </div>;
}
