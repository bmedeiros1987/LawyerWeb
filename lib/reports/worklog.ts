import { prisma } from "@/lib/prisma";
import { allows, contractScope, deadlineScope, documentScope, inboxScope, matterScope, taskScope, type Viewer } from "@/lib/authz/visibility";

type Entry = { entityType: string; entityId: string | null; metadata: unknown };

// Recheck the live entity, not only who originally wrote the log. Revoked ACLs,
// deleted records and unknown entity types fail closed, including old summaries.
export async function visibleActivities<T extends Entry>(viewer: Viewer, entries: T[]): Promise<T[]> {
  const ids = (type: string) => entries.filter(e => e.entityType === type && e.entityId).map(e => e.entityId!);
  const [matters, tasks, deadlines, contracts, documents, communications, demands, clients] = await Promise.all([
    prisma.matter.findMany({ where: { AND: [matterScope(viewer), { id: { in: ids("Matter") } }] }, select: { id: true } }),
    prisma.legalTask.findMany({ where: { AND: [taskScope(viewer), { id: { in: ids("LegalTask") } }] }, select: { id: true } }),
    prisma.deadline.findMany({ where: { AND: [deadlineScope(viewer), { id: { in: ids("Deadline") } }] }, select: { id: true } }),
    prisma.contract.findMany({ where: { AND: [contractScope(viewer), { id: { in: ids("Contract") } }] }, select: { id: true } }),
    prisma.legalDocument.findMany({ where: { AND: [documentScope(viewer), { id: { in: ids("LegalDocument") } }] }, select: { id: true } }),
    prisma.courtCommunication.findMany({ where: { AND: [inboxScope(viewer), { id: { in: ids("CourtCommunication") } }] }, select: { id: true } }),
    prisma.intakeDemand.findMany({ where: { AND: [inboxScope(viewer), { id: { in: ids("IntakeDemand") } }] }, select: { id: true } }),
    allows(viewer, "clients.view") ? prisma.client.findMany({ where: { workspaceId: viewer.workspaceId, id: { in: ids("Client") } }, select: { id: true } }) : [],
  ]);
  const visible = new Map<string, Set<string>>([
    ["Matter", new Set(matters.map(x => x.id))], ["LegalTask", new Set(tasks.map(x => x.id))],
    ["Deadline", new Set(deadlines.map(x => x.id))], ["Contract", new Set(contracts.map(x => x.id))],
    ["LegalDocument", new Set(documents.map(x => x.id))], ["CourtCommunication", new Set(communications.map(x => x.id))],
    ["IntakeDemand", new Set(demands.map(x => x.id))], ["Client", new Set(clients.map(x => x.id))],
  ]);
  const referencedMatterIds = entries.flatMap(entry => {
    const metadata = entry.metadata as { matterId?: unknown } | null;
    return typeof metadata?.matterId === "string" ? [metadata.matterId] : [];
  });
  const visibleReferences = new Set((await prisma.matter.findMany({
    where: { AND: [matterScope(viewer), { id: { in: referencedMatterIds } }] }, select: { id: true },
  })).map(x => x.id));
  return entries.filter(entry => {
    if (!entry.entityId || !visible.get(entry.entityType)?.has(entry.entityId)) return false;
    const metadata = entry.metadata as { matterId?: unknown } | null;
    return typeof metadata?.matterId !== "string" || visibleReferences.has(metadata.matterId);
  });
}
