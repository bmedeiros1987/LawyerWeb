import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, Clock3, Link2 } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getActiveMembership } from "@/lib/workspace/context";

export const dynamic = "force-dynamic";

function dateOnlyLabel(value: string | null) {
  if (!value) return "Data não informada";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year} · dia inteiro` : value;
}

function kindLabel(kind: string) {
  return kind === "HEARING" ? "Audiência"
    : kind === "MEETING" ? "Reunião"
    : kind === "TASK" ? "Tarefa"
    : kind === "DEADLINE" ? "Prazo"
    : "Compromisso";
}

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const member = await getActiveMembership(session.user.id);
  if (!member) redirect("/app/setup");

  const now = new Date();
  const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const startDate = now.toISOString().slice(0, 10);
  const endDate = horizon.toISOString().slice(0, 10);

  const [events, connection] = await Promise.all([
    prisma.legalCalendarEvent.findMany({
      where: {
        userId: session.user.id,
        status: { not: "CANCELLED" },
        OR: [
          { startAt: { gte: now, lte: horizon } },
          { startDate: { gte: startDate, lte: endDate } },
        ],
      },
      orderBy: [{ startAt: "asc" }, { startDate: "asc" }, { createdAt: "asc" }],
      take: 100,
    }),
    prisma.googleCalendarConnection.findUnique({
      where: { userId: session.user.id },
      select: { googleEmail: true, calendarName: true, calendarId: true },
    }),
  ]);

  const connectionLabel = connection?.calendarId
    ? "Google Calendar conectado"
    : connection
      ? "Google autorizado · agenda pendente"
      : "Google Calendar não conectado";

  return <div className="page-stack">
    <section className="page-header">
      <div>
        <span className="eyebrow">Agenda jurídica</span>
        <h1>Agenda</h1>
        <p>Somente compromissos reais já salvos ou sincronizados. Nenhum evento de demonstração é exibido.</p>
      </div>
      <Link href="/app/integrations" className="filter-button"><Link2 size={16}/>Integrações</Link>
    </section>

    <section className="panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Sincronização</span><h2>Google Calendar</h2></div>
        <span className={"status-pill " + (connection?.calendarId ? "success" : "quiet")}>{connectionLabel}</span>
      </div>
      <p className="report-caveat">
        {connection?.googleEmail ? `Conta autorizada: ${connection.googleEmail}. ` : ""}
        Esta tela é somente leitura. Datas candidatas do Deadline Safety não são convertidas automaticamente em eventos.
      </p>
    </section>

    {events.length === 0
      ? <div className="empty-state">
          <CalendarDays size={28}/>
          <h2>Nenhum compromisso sincronizado nos próximos 14 dias</h2>
          <p>A ausência é real: não há evento salvo para este usuário nessa janela. Conecte ou revise o Google Calendar em Integrações quando necessário.</p>
        </div>
      : <section className="panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Próximos 14 dias</span><h2>Compromissos</h2></div>
            <span className="status-pill quiet">{events.length} evento{events.length === 1 ? "" : "s"}</span>
          </div>
          <div className="simple-list">
            {events.map(event => {
              const when = event.allDay
                ? dateOnlyLabel(event.startDate)
                : event.startAt?.toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: member.workspace.timezone,
                  }) ?? "Horário não informado";
              const source = event.source === "GOOGLE" ? "Google" : "LawyerMind";
              return <div key={event.id}>
                <span className="table-icon"><Clock3 size={15}/></span>
                <div>
                  <strong>{event.title}</strong>
                  <small>{when} · {kindLabel(event.kind)}{event.location ? " · " + event.location : ""}</small>
                </div>
                <span className="status-pill quiet">{source}</span>
              </div>;
            })}
          </div>
        </section>}
  </div>;
}
