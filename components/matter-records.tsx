import { prisma } from "@/lib/prisma";
import { allows, matterScope, type Viewer } from "@/lib/authz/visibility";
import { MatterRecordForms } from "@/components/matter-record-forms";

export async function MatterRecords({ matterId, viewer, timeZone }: { matterId: string; viewer: Viewer; timeZone: string }) {
  if (process.env.PROCESS_REGISTER_ENABLED !== "true") return null;
  const where = { matterId, matter: matterScope(viewer) };
  const [parties, phases, movements, clients] = await Promise.all([
    prisma.matterParty.findMany({ where, include: { person: { include: { client: { select: { name: true } } } } }, orderBy: { createdAt: "asc" }, take: 200 }),
    prisma.matterPhase.findMany({ where, orderBy: { startedAt: "desc" }, take: 100 }),
    prisma.matterMovement.findMany({ where, include: { phase: { select: { name: true } } }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], take: 100 }),
    allows(viewer, "clients.view") && allows(viewer, "matters.edit") ? prisma.client.findMany({ where: { workspaceId: viewer.workspaceId, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }) : [],
  ]);
  const fmt = (date: Date) => date.toLocaleString("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" });
  const people = [...new Map(parties.map(p => [p.personId, { id: p.personId, name: p.person.client?.name ?? p.person.name ?? "Pessoa" }])).values()];
  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">Prontuário</span><h2>Partes, fases e andamentos</h2></div></div>
    <div className="client-detail-grid">
      <div><h3>Partes</h3>{parties.length === 0 ? <p className="mini-empty">Nenhuma parte vinculada.</p> : <div className="simple-list">{parties.map(p => <div key={p.id}><div><strong>{p.person.client?.name ?? p.person.name}</strong><small>{p.role} · {p.side === "CLAIMANT" ? "polo ativo" : p.side === "RESPONDENT" ? "polo passivo" : "outro / terceiro"}</small></div></div>)}</div>}</div>
      <div><h3>Fases</h3>{phases.length === 0 ? <p className="mini-empty">Nenhuma fase registrada.</p> : <div className="simple-list">{phases.map(p => <div key={p.id}><div><strong>{p.name}</strong><small>{[p.number, p.court, fmt(p.startedAt)].filter(Boolean).join(" · ")}</small>{p.notes && <p>{p.notes}</p>}</div></div>)}</div>}</div>
    </div>
    <h3>Andamentos recentes</h3>
    {movements.length === 0 ? <p className="mini-empty">Nenhum andamento registrado.</p> : <div className="simple-list">{movements.map(m => <div key={m.id}><div><strong>{m.title}</strong><small>{fmt(m.occurredAt)} · {m.source === "MANUAL" ? "registro manual" : "comunicação vinculada"}{m.phase ? ` · ${m.phase.name}` : ""}</small>{m.description && <p style={{ whiteSpace: "pre-wrap" }}>{m.description}</p>}{m.sourceUrl?.startsWith("https://") && <a href={m.sourceUrl} target="_blank" rel="noopener noreferrer">Consultar fonte</a>}</div></div>)}</div>}
    <p className="form-hint">Exibidos até 200 partes, 100 fases e os 100 andamentos mais recentes. A data do andamento é distinta da atualização interna do cadastro.</p>
    {allows(viewer, "matters.edit") && <MatterRecordForms matterId={matterId} clients={clients} people={people} phases={phases.map(p => ({ id: p.id, name: p.name }))}/>}
  </section>;
}
