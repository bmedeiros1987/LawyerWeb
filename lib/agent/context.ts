import { prisma } from "@/lib/prisma";
import { contractScope, deadlineScope, matterScope, taskScope, type Viewer } from "@/lib/authz/visibility";

function fmt(date:Date|null|undefined,timeZone:string){
  return date?date.toLocaleString("pt-BR",{timeZone,dateStyle:"short",timeStyle:"short"}):"—";
}

export async function buildAgentContext(viewer:Viewer,timeZone:string){
  const now=new Date();
  const [deadlines,tasks,matters,contracts]=await Promise.all([
    prisma.deadline.findMany({
      where:{...deadlineScope(viewer),status:{in:["CONFIRMED","IN_PROGRESS","CANDIDATE","PENDING_CONFIRMATION"]}},
      include:{matter:{select:{number:true,title:true}}},
      orderBy:[{dueAt:"asc"},{createdAt:"desc"}],take:8,
    }),
    prisma.legalTask.findMany({
      where:{...taskScope(viewer),status:{notIn:["DONE","CANCELLED"]},OR:[{assigneeUserId:viewer.userId},{requesterUserId:viewer.userId},{reviewerUserId:viewer.userId},{assigneeUserId:null}]},
      include:{matter:{select:{number:true,title:true}}},
      orderBy:[{dueAt:"asc"},{createdAt:"desc"}],take:8,
    }),
    prisma.matter.findMany({
      where:{...matterScope(viewer)},include:{client:{select:{name:true}}},
      orderBy:{updatedAt:"desc"},take:6,
    }),
    prisma.contract.findMany({
      where:{...contractScope(viewer),status:{in:["REVIEW","SIGNING","ACTIVE","EXPIRING"]}},
      include:{client:{select:{name:true}}},orderBy:[{expiresAt:"asc"},{updatedAt:"desc"}],take:6,
    }),
  ]);

  const confirmedDeadlines=deadlines.filter(d=>d.status==="CONFIRMED"||d.status==="IN_PROGRESS");
  const candidateDeadlines=deadlines.filter(d=>d.status==="CANDIDATE"||d.status==="PENDING_CONFIRMATION");

  const lines=[
    `Agora: ${fmt(now,timeZone)}.`,
    "Prazos confirmados em vigor:",
    ...(confirmedDeadlines.length?confirmedDeadlines.map(d=>`- [${d.status}/${d.risk}] ${d.title} | ${d.matter?.number??d.matter?.title??"sem processo"} | prazo ${fmt(d.dueAt,timeZone)} | interno ${fmt(d.internalDueAt,timeZone)}`):["- sem prazo confirmado em vigor"]),
    "Datas candidatas — NÃO são prazo em vigor e exigem revisão humana:",
    ...(candidateDeadlines.length?candidateDeadlines.map(d=>`- [${d.status}] ${d.title} | ${d.matter?.number??d.matter?.title??"sem processo"} | data sugerida ${fmt(d.dueAt,timeZone)}`):["- nenhuma data candidata pendente"]),
    "Tarefas visíveis:",
    ...tasks.map(t=>`- [${t.status}/${t.priority}] ${t.title} | ${t.matter?.number??t.matter?.title??"sem processo"} | ${fmt(t.dueAt,timeZone)}`),
    "Processos recentes visíveis:",
    ...matters.map(m=>`- ${m.number??m.internalCode??m.title} | ${m.title} | cliente ${m.client?.name??"—"} | fase ${m.phase??"—"}`),
    "Contratos visíveis:",
    ...contracts.map(c=>`- [${c.status}] ${c.title} | ${c.client?.name??c.counterparty??"—"} | vence ${fmt(c.expiresAt,timeZone)}`),
  ];
  return lines.join("\n").slice(0,18_000);
}
