import { notificationFault } from "./helpers/notification-fault";
import { assertDisposableDatabase, guardedDatabaseLifecycle } from "./helpers/disposable-db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

// External I/O is simulated; the database is a real, isolated PostgreSQL with fictitious data only.
const session = vi.hoisted(() => ({ user: { id: "" } }));
const wp = vi.hoisted(() => ({ setVapidDetails: vi.fn(), sendNotification: vi.fn() }));
vi.mock("@/auth", () => ({ auth: async () => session }));
vi.mock("web-push", () => ({ default: wp }));

import { prisma } from "@/lib/prisma";
import { syncMatterFromDataJud, syncMatterFromDjen, type CourtPushMatter } from "@/lib/courts/push";
import { POST as cronPoll } from "@/app/api/cron/court-push/route";
import { POST as manualRefresh } from "@/app/api/integrations/court-push/refresh/route";

// 20-digit CNJ numbers (TJDFT: justice 8, tribunal 07). Entirely fictitious.
const cnj = (n: number) => {
  const d = `${String(n).padStart(7, "0")}${"00"}2026${"8"}${"07"}${"0000"}`;
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d[13]}.${d.slice(14, 16)}.${d.slice(16)}`;
};
const digits = (value: string) => value.replace(/\D/g, "");

type Movement = { codigo: number; nome: string; dataHora: string };
const mov = (i: number): Movement => ({ codigo: 100 + i, nome: `Movimentação fictícia ${i}`, dataHora: new Date(Date.UTC(2026, 8, 1 + i, 12)).toISOString() });
const movs = (n: number) => Array.from({ length: n }, (_, i) => mov(i));

const djenItem = (i: number, number: string) => ({
  id: 9000 + i, hash: `hashDJEN${String(i).padStart(8, "0")}`, data_disponibilizacao: "2026-10-01", siglaTribunal: "TJDFT",
  tipoComunicacao: "Intimação", nomeOrgao: "1ª Vara fictícia", texto: `<p>Texto confidencial fictício ${i}</p>`,
  numero_processo: digits(number), numeroComunicacao: 5000 + i, ativo: true,
});

const world = vi.hoisted(() => ({ datajud: new Map<string, unknown[]>(), djen: new Map<string, unknown[]>(), calls: [] as string[] }));

function installFetch() {
  world.calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("api_publica_")) {
      const number = JSON.parse(String(init?.body)).query.match.numeroProcesso as string;
      world.calls.push(`datajud:${number}`);
      const movimentos = world.datajud.get(number);
      if (!movimentos) return new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 });
      return new Response(JSON.stringify({ hits: { hits: [{ _id: `proc-${number}`, _source: { id: `proc-${number}`, tribunal: "TJDFT", numeroProcesso: number, movimentos } }] } }), { status: 200 });
    }
    const q = new URL(url).searchParams;
    const number = q.get("numeroProcesso") as string;
    world.calls.push(`djen:${number}`);
    const items = q.get("pagina") === "1" ? world.djen.get(number) ?? [] : [];
    return new Response(JSON.stringify({ status: "success", count: items.length, items }), { status: 200 });
  }));
}

const created = { workspaces: [] as string[], users: [] as string[] };
type Tenant = { workspaceId: string; owner: string; responsible: string; outsider: string; fullRoleId: string };

async function makeTenant(label: string): Promise<Tenant> {
  const ws = await prisma.workspace.create({ data: { name: `Court ${label}`, slug: `court-${label}-${randomUUID()}` } });
  created.workspaces.push(ws.id);
  const full = await prisma.workspaceRole.create({ data: { workspaceId: ws.id, name: "Full", permissions: { allow: ["*"] } } });
  const users: string[] = [];
  for (const who of ["owner", "responsible", "outsider"]) {
    const user = await prisma.user.create({ data: { name: `${label}-${who}` } });
    created.users.push(user.id);
    users.push(user.id);
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: user.id, roleId: full.id } });
  }
  return { workspaceId: ws.id, owner: users[0], responsible: users[1], outsider: users[2], fullRoleId: full.id };
}

async function makeMatter(t: Tenant, number: string, over: Partial<{ secrecy: boolean; status: string; ownerUserId: string | null; responsibleUserId: string | null }> = {}) {
  return prisma.matter.create({
    data: { workspaceId: t.workspaceId, title: "Processo fictício", number, court: "TJDFT", ownerUserId: t.owner, responsibleUserId: null, ...over },
  });
}
async function load(id: string): Promise<CourtPushMatter> {
  return prisma.matter.findUniqueOrThrow({ where: { id }, select: { id: true, workspaceId: true, number: true, court: true, secrecy: true, ownerUserId: true, responsibleUserId: true } });
}
const comms = (matterId: string, source?: string) => prisma.courtCommunication.count({ where: { matterId, ...(source ? { source } : {}) } });
const notes = (userId: string, workspaceId?: string) => prisma.userNotification.count({ where: { userId, type: "COURT_UPDATE", ...(workspaceId ? { workspaceId } : {}) } });
async function subscribe(userId: string, tag: string) {
  return prisma.pushSubscription.create({ data: { userId, endpoint: `https://push.invalid/${tag}-${randomUUID()}`, p256dh: "p256dh-fake", auth: "auth-fake" } });
}
function vapid(on: boolean) {
  if (on) {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "fake-public"; process.env.VAPID_PRIVATE_KEY = "fake-private"; process.env.VAPID_SUBJECT = "mailto:test@example.invalid";
  } else {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT;
  }
}

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("Court Push — integration on an isolated database (fictitious cases)", () => {
  let n = 1;
  const nextNumber = () => cnj(n++);

  const dbLifecycle = guardedDatabaseLifecycle();
  const fault = notificationFault(prisma);
  beforeAll(() => dbLifecycle.setup(async () => {
    vapid(false);
    await fault.install();
  }, () => prisma.$disconnect()));
  afterAll(() => dbLifecycle.cleanup(async () => {
    try {
      await fault.remove();
      await prisma.workspace.deleteMany({ where: { id: { in: created.workspaces } } });
      await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    } finally {
      await prisma.$disconnect();
      vi.unstubAllGlobals();
    }
  }));
  beforeEach(() => {
    world.datajud.clear(); world.djen.clear(); installFetch();
    wp.sendNotification.mockReset(); wp.setVapidDetails.mockReset();
    vi.restoreAllMocks(); installFetch(); vapid(false);
  });

  // ------------------------------------------------------------------ ingestion / idempotence
  describe("DataJud ingestion (monitoring of already-registered matters)", () => {
    it("bootstraps with the latest movement only, and a repeated poll neither re-imports history nor re-notifies", async () => {
      const t = await makeTenant("dj1"); const number = nextNumber();
      const matter = await makeMatter(t, number);
      world.datajud.set(digits(number), movs(10));

      const first = await syncMatterFromDataJud(await load(matter.id));
      expect(first.imported).toBe(1);
      expect(await comms(matter.id, "DATAJUD")).toBe(1);
      expect(await notes(t.owner)).toBe(1);

      // same DataJud answer again: nothing new happened at the court
      const second = await syncMatterFromDataJud(await load(matter.id));
      expect(second.imported, "historical movements must not be back-filled and announced on the 2nd poll").toBe(0);
      expect(await comms(matter.id, "DATAJUD")).toBe(1);
      expect(await notes(t.owner)).toBe(1);
    });

    it("imports and notifies only a genuinely new movement", async () => {
      const t = await makeTenant("dj2"); const number = nextNumber();
      const matter = await makeMatter(t, number);
      world.datajud.set(digits(number), movs(5));
      await syncMatterFromDataJud(await load(matter.id));
      await syncMatterFromDataJud(await load(matter.id));
      world.datajud.set(digits(number), movs(6));
      const third = await syncMatterFromDataJud(await load(matter.id));
      expect(third.imported).toBe(1);
      expect(await comms(matter.id, "DATAJUD")).toBe(2);
      expect(await notes(t.owner)).toBe(2);
      const rows = await prisma.courtCommunication.findMany({ where: { matterId: matter.id } });
      expect(rows.every(r => r.requiresAction === false && r.status === "NEW")).toBe(true);
      expect(await prisma.deadline.count({ where: { workspaceId: t.workspaceId } })).toBe(0);
      expect(await prisma.matterMovement.count({ where: { matterId: matter.id } })).toBe(0);
    });

    it("concurrent polls of the same matter create one record and one notification per recipient", async () => {
      const t = await makeTenant("dj3"); const number = nextNumber();
      const matter = await makeMatter(t, number, { responsibleUserId: t.responsible });
      world.datajud.set(digits(number), movs(3));
      await syncMatterFromDataJud(await load(matter.id));
      world.datajud.set(digits(number), movs(4));
      await Promise.all([1, 2, 3, 4].map(async () => syncMatterFromDataJud(await load(matter.id))));
      expect(await comms(matter.id, "DATAJUD")).toBe(2);
      expect(await notes(t.owner)).toBe(2);        // bootstrap + the one new movement
      expect(await notes(t.responsible)).toBe(2);
      expect(await notes(t.outsider)).toBe(0);
    });
  });

  describe("DataJud late arrival and backlog regressions", () => {
    it("persists a newly available older movement, then deduplicates it", async () => {
      const t = await makeTenant("late"); const number = nextNumber(); const matter = await makeMatter(t, number);
      world.datajud.set(digits(number), [mov(0)]); await syncMatterFromDataJud(await load(matter.id));
      world.datajud.set(digits(number), [mov(0), mov(10)]); await syncMatterFromDataJud(await load(matter.id));
      world.datajud.set(digits(number), [mov(10), mov(5), mov(0)]);
      expect((await syncMatterFromDataJud(await load(matter.id))).imported).toBe(1);
      expect((await syncMatterFromDataJud(await load(matter.id))).imported).toBe(0);
      expect(await comms(matter.id, "DATAJUD")).toBe(3); expect(await notes(t.owner)).toBe(3);
    });
    it("recovers 51 new identities in two bounded transactions without historical notifications", async () => {
      const t = await makeTenant("overflow"); const number = nextNumber(); const matter = await makeMatter(t, number);
      world.datajud.set(digits(number), movs(10)); await syncMatterFromDataJud(await load(matter.id));
      world.datajud.set(digits(number), movs(61).reverse());
      expect(await syncMatterFromDataJud(await load(matter.id))).toMatchObject({ imported: 50, truncated: true });
      expect(await syncMatterFromDataJud(await load(matter.id))).toMatchObject({ imported: 1, truncated: false });
      expect((await syncMatterFromDataJud(await load(matter.id))).imported).toBe(0);
      expect(await comms(matter.id, "DATAJUD")).toBe(52); expect(await notes(t.owner)).toBe(52);
      expect(await prisma.deadline.count({ where: { workspaceId: t.workspaceId } })).toBe(0);
      expect(await prisma.matterMovement.count({ where: { matterId: matter.id } })).toBe(0);
    });
  });

  describe("DJEN ingestion (monitoring of already-registered matters)", () => {
    it("first activation preserves recent evidence but notifies only the newest; repeats are idempotent; a new publication notifies once", async () => {
      const t = await makeTenant("dn1"); const number = nextNumber();
      const matter = await makeMatter(t, number);
      world.djen.set(digits(number), [djenItem(1, number), djenItem(2, number), djenItem(3, number)]);

      const first = await syncMatterFromDjen(await load(matter.id));
      expect(first.imported).toBe(3);
      expect(await comms(matter.id, "DJEN")).toBe(3);
      expect(await notes(t.owner)).toBe(1);

      expect((await syncMatterFromDjen(await load(matter.id))).imported).toBe(0);
      expect(await notes(t.owner)).toBe(1);

      world.djen.set(digits(number), [djenItem(1, number), djenItem(2, number), djenItem(3, number), djenItem(4, number)]);
      expect((await syncMatterFromDjen(await load(matter.id))).imported).toBe(1);
      expect(await comms(matter.id, "DJEN")).toBe(4);
      expect(await notes(t.owner)).toBe(2);
      expect(await prisma.deadline.count({ where: { workspaceId: t.workspaceId } })).toBe(0);
    });
  });

  // ------------------------------------------------------------------ isolation
  describe("isolation between offices", () => {
    it("the same public case monitored by two offices yields separate records and notifications only for each office's own users", async () => {
      const a = await makeTenant("isoA"), b = await makeTenant("isoB"); const number = nextNumber();
      const ma = await makeMatter(a, number), mb = await makeMatter(b, number);
      world.datajud.set(digits(number), movs(2));
      await syncMatterFromDataJud(await load(ma.id));
      expect(await comms(ma.id)).toBe(1);
      expect(await comms(mb.id)).toBe(0);
      expect(await notes(b.owner)).toBe(0);
      await syncMatterFromDataJud(await load(mb.id));
      expect(await comms(mb.id)).toBe(1);
      expect(await prisma.courtCommunication.count({ where: { workspaceId: a.workspaceId, matterId: mb.id } })).toBe(0);
      expect(await notes(a.owner, b.workspaceId)).toBe(0);
      expect(await notes(b.owner, a.workspaceId)).toBe(0);
      expect(await notes(a.owner, a.workspaceId)).toBe(1);
      expect(await notes(b.owner, b.workspaceId)).toBe(1);
    });

    it("never queries the courts for a secret matter, and never notifies a user without access to a secret matter", async () => {
      const t = await makeTenant("sec"); const number = nextNumber();
      const secret = await makeMatter(t, number, { secrecy: true });
      world.datajud.set(digits(number), movs(2)); world.djen.set(digits(number), [djenItem(1, number)]);
      const before = world.calls.length;
      expect((await syncMatterFromDataJud(await load(secret.id))).skipped).toBe("secret-matter");
      expect((await syncMatterFromDjen(await load(secret.id))).skipped).toBe("secret-matter");
      expect(world.calls.length).toBe(before);
      expect(await comms(secret.id)).toBe(0);
      // even if a matter becomes secret after ingestion, a user without explicit access is not notified
      const n2 = nextNumber(); const m2 = await makeMatter(t, n2, { responsibleUserId: t.responsible });
      world.datajud.set(digits(n2), movs(1));
      await prisma.matter.update({ where: { id: m2.id }, data: { secrecy: false } });
      const res = await syncMatterFromDataJud(await load(m2.id));
      expect(res.imported).toBe(1);
      await prisma.matter.update({ where: { id: m2.id }, data: { secrecy: true } });
      world.datajud.set(digits(n2), movs(2));
      const live = { ...(await load(m2.id)), secrecy: false }; // stale in-memory snapshot, as in a long batch
      await syncMatterFromDataJud(live);
      expect(await notes(t.owner)).toBe(1);        // owner of the first notification only; none for the secret-time one
      expect(await notes(t.responsible)).toBe(1);
    });

    it("manual refresh only touches matters inside the caller's scope and workspace", async () => {
      const a = await makeTenant("refA"), b = await makeTenant("refB");
      const na = nextNumber(), nb = nextNumber();
      const ma = await makeMatter(a, na), mb = await makeMatter(b, nb);
      world.datajud.set(digits(na), movs(2)); world.datajud.set(digits(nb), movs(2));
      world.djen.set(digits(na), [djenItem(1, na)]); world.djen.set(digits(nb), [djenItem(2, nb)]);
      session.user.id = a.owner;
      const res = await manualRefresh(new NextRequest("http://localhost/api/integrations/court-push/refresh", { method: "POST" }));
      expect(res.status).toBe(303);
      expect(await comms(ma.id)).toBeGreaterThan(0);
      expect(await comms(mb.id)).toBe(0);
      expect(world.calls.every(c => c.endsWith(digits(na)))).toBe(true);
    });
  });

  // ------------------------------------------------------------------ notification reliability
  describe("notification reliability", () => {
    it("a recipient who lost access must not block the others, nor lose the notification forever", async () => {
      const t = await makeTenant("rel1"); const number = nextNumber();
      const matter = await makeMatter(t, number, { responsibleUserId: t.responsible });
      await prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: t.workspaceId, userId: t.owner } }, data: { status: "SUSPENDED" } });
      world.datajud.set(digits(number), movs(2));

      const result = await syncMatterFromDataJud(await load(matter.id)).catch(error => ({ error }));
      expect("error" in result, "an inactive owner must not make the whole ingestion throw").toBe(false);
      expect(await notes(t.owner)).toBe(0);
      expect(await notes(t.responsible)).toBe(1);
    });

    it("if notifying fails, the communication is not silently left un-notified: the next poll still notifies", async () => {
      const t = await makeTenant("rel2"); const number = nextNumber();
      const matter = await makeMatter(t, number);
      world.datajud.set(digits(number), movs(2));
      // Real fault injection: PostgreSQL itself rejects the notification insert while the trigger is enabled.
      await fault.enable(true);
      try { await syncMatterFromDataJud(await load(matter.id)).catch(() => undefined); }
      finally { await fault.enable(false); }
      await syncMatterFromDataJud(await load(matter.id)).catch(() => undefined);
      expect(await notes(t.owner), "at-least-once: the notification must exist after a retry").toBe(1);
      expect(await comms(matter.id, "DATAJUD")).toBe(1);
    });

    it("movements that share the newest timestamp are not lost, and a poll never announces older history", async () => {
      const t = await makeTenant("rel3"); const number = nextNumber();
      const matter = await makeMatter(t, number);
      const same = "2026-10-05T12:00:00.000Z";
      world.datajud.set(digits(number), [...movs(4), { codigo: 900, nome: "Juntada A", dataHora: same }]);
      await syncMatterFromDataJud(await load(matter.id));
      world.datajud.set(digits(number), [...movs(4), { codigo: 900, nome: "Juntada A", dataHora: same }, { codigo: 901, nome: "Juntada B (mesmo instante)", dataHora: same }]);
      const res = await syncMatterFromDataJud(await load(matter.id));
      expect(res.imported).toBe(1);
      expect(await comms(matter.id, "DATAJUD")).toBe(2);
      const titles = (await prisma.courtCommunication.findMany({ where: { matterId: matter.id } })).map(r => r.title).sort();
      expect(titles).toEqual(["Juntada A", "Juntada B (mesmo instante)"]);
    });
  });

  // ------------------------------------------------------------------ Web Push honesty
  describe("Web Push result is reported honestly (accepted by push service != delivered to device)", () => {
    async function oneNotifiedMatter(label: string) {
      const t = await makeTenant(label); const number = nextNumber();
      const matter = await makeMatter(t, number);
      world.datajud.set(digits(number), movs(1));
      return { t, matter };
    }

    it("VAPID not configured: in-app notification is created, no push is attempted, and the result says so", async () => {
      const { t, matter } = await oneNotifiedMatter("wp1");
      await subscribe(t.owner, "wp1");
      vapid(false);
      const res = await syncMatterFromDataJud(await load(matter.id));
      expect(res.inAppNotified).toBe(1);
      expect(wp.sendNotification).not.toHaveBeenCalled();
      expect(res.push).toMatchObject({ accepted: 0, skippedNoVapid: 1, subscriptions: 0, failed: 0 });
      expect("notified" in res, "the ambiguous `notified` counter must not exist").toBe(false);
    });

    it("VAPID configured but the user has no device subscription", async () => {
      const { t, matter } = await oneNotifiedMatter("wp2");
      vapid(true);
      const res = await syncMatterFromDataJud(await load(matter.id));
      expect(res.inAppNotified).toBe(1);
      expect(res.push).toMatchObject({ accepted: 0, skippedNoSubscription: 1, skippedNoVapid: 0 });
      expect(wp.sendNotification).not.toHaveBeenCalled();
    });

    it("push accepted by the push service is counted as accepted, with a generic payload", async () => {
      const { t, matter } = await oneNotifiedMatter("wp3");
      await subscribe(t.owner, "wp3a"); await subscribe(t.owner, "wp3b");
      vapid(true); wp.sendNotification.mockResolvedValue({ statusCode: 201 });
      const res = await syncMatterFromDataJud(await load(matter.id));
      expect(res.push).toMatchObject({ subscriptions: 2, accepted: 2, failed: 0, removed: 0 });
      const payload = String(wp.sendNotification.mock.calls[0][1]);
      expect(payload).toContain("/app/inbox");
      expect(payload).not.toContain(digits(matter.number!));
      expect(payload).not.toContain(matter.number!);
      expect(payload).not.toContain("Movimentação fictícia");
      expect(payload).not.toContain("Processo fictício");
    });

    it("push rejected (e.g. 401/403/413/500 or network error) is a failure, never a delivery; the subscription is kept", async () => {
      const { t, matter } = await oneNotifiedMatter("wp4");
      const sub = await subscribe(t.owner, "wp4");
      vapid(true); wp.sendNotification.mockRejectedValue(Object.assign(new Error("Unauthorized"), { statusCode: 401 }));
      const res = await syncMatterFromDataJud(await load(matter.id));
      expect(res.inAppNotified).toBe(1);
      expect(res.push).toMatchObject({ subscriptions: 1, accepted: 0, failed: 1, removed: 0 });
      expect(await prisma.pushSubscription.count({ where: { id: sub.id } })).toBe(1);
    });

    it("expired subscriptions (404/410) are removed and reported as removed, not as delivered", async () => {
      const { t, matter } = await oneNotifiedMatter("wp5");
      const sub = await subscribe(t.owner, "wp5");
      vapid(true); wp.sendNotification.mockRejectedValue(Object.assign(new Error("Gone"), { statusCode: 410 }));
      const res = await syncMatterFromDataJud(await load(matter.id));
      expect(res.push).toMatchObject({ accepted: 0, removed: 1 });
      expect(await prisma.pushSubscription.count({ where: { id: sub.id } })).toBe(0);
    });

    it("a push-layer crash never undoes ingestion or the in-app notification", async () => {
      const { t, matter } = await oneNotifiedMatter("wp6");
      await subscribe(t.owner, "wp6");
      vapid(true); wp.sendNotification.mockImplementation(() => { throw new Error("boom"); });
      const res = await syncMatterFromDataJud(await load(matter.id));
      expect(res.imported).toBe(1);
      expect(res.inAppNotified).toBe(1);
      expect(res.push.accepted).toBe(0);
      expect(await notes(t.owner)).toBe(1);
    });
  });

  // ------------------------------------------------------------------ cron endpoint
  describe("POST /api/cron/court-push (isolated DB only; fetch simulated)", () => {
    const req = (secret?: string) => new NextRequest("http://localhost/api/cron/court-push", { method: "POST", headers: secret ? { authorization: `Bearer ${secret}` } : {} });

    it("rejects missing/wrong secrets without touching anything", async () => {
      const before = world.calls.length;
      expect((await cronPoll(req())).status).toBe(401);
      expect((await cronPoll(req("wrong"))).status).toBe(401);
      expect(world.calls.length).toBe(before);
    });

    beforeEach(async () => {
      // Cron polls every eligible matter: clear only fixtures owned by this suite.
      assertDisposableDatabase();
      await prisma.workspace.deleteMany({ where: { id: { in: created.workspaces } } });
      created.workspaces.length = 0;
    });

    it("polls fictitious matters, writes only CourtCommunication/UserNotification, and its summary does not call push 'delivered'", async () => {
      const t = await makeTenant("cron1"); const number = nextNumber();
      const matter = await makeMatter(t, number, { responsibleUserId: t.responsible });
      const sec = await makeMatter(t, nextNumber(), { secrecy: true });
      const closed = await makeMatter(t, nextNumber(), { status: "ARCHIVED" });
      world.datajud.set(digits(number), movs(3)); world.djen.set(digits(number), [djenItem(1, number)]);
      await subscribe(t.owner, "cron1");
      vapid(true); wp.sendNotification.mockResolvedValue({ statusCode: 201 });

      const res = await cronPoll(req(process.env.CRON_SECRET));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deadlineWrites).toBe(0); expect(body.externalActions).toBe(0);
      expect(JSON.stringify(body)).not.toContain("\"notified\"");
      expect(body.datajud.imported).toBeGreaterThanOrEqual(1);
      expect(body.datajud.inAppNotified).toBeGreaterThanOrEqual(1);
      expect(body.push.accepted).toBeGreaterThanOrEqual(1);
      expect(body.push.skippedNoSubscription).toBeGreaterThanOrEqual(1);   // the responsible user has no device
      expect(body.pushNote).toMatch(/not confirmed|não confirm/i);
      expect(await comms(matter.id)).toBeGreaterThanOrEqual(2);
      expect(await comms(sec.id)).toBe(0);
      expect(await comms(closed.id)).toBe(0);
      expect(world.calls.some(c => c.includes(digits(sec.number!)))).toBe(false);
      expect(await prisma.deadline.count({ where: { workspaceId: t.workspaceId } })).toBe(0);
      expect(await prisma.matterMovement.count({ where: { matterId: matter.id } })).toBe(0);
    });

    it("a DJEN 429 stops the DJEN pass immediately and is not retried", async () => {
      const t = await makeTenant("cron2"); const n1 = nextNumber(), n2 = nextNumber();
      await makeMatter(t, n1); await makeMatter(t, n2);
      installFetch();
      const inner = vi.mocked(fetch).getMockImplementation()!;
      let djenCalls = 0;
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (!String(input).includes("api_publica_")) { djenCalls += 1; return new Response("slow down", { status: 429, headers: { "retry-after": "30" } }); }
        return inner(input, init);
      }));
      const body = await (await cronPoll(req(process.env.CRON_SECRET))).json();
      expect(body.djen.rateLimited).toBe(true);
      expect(djenCalls).toBe(1);
    });
  });
});
