import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  courtCommunication: {
    count: vi.fn(),
    createMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  userNotification: { create: vi.fn() },
}));
const access = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/authz/permissions", () => ({
  P: { MATTERS_VIEW: "matters.view" },
  canAccessMatter: access,
}));
vi.mock("@/lib/push/webpush", () => ({ sendPushToUser: push }));

import {
  dataJudAliasFromCourt,
  dataJudAliasFromProcessNumber,
  dataJudMovementIdentity,
  orderedDataJudMovements,
} from "@/lib/courts/datajud";
import { syncMatterFromDataJud } from "@/lib/courts/push";

const matter = {
  id: "matter-1",
  workspaceId: "workspace-1",
  number: "0000000-00.2026.8.07.0000",
  court: "TJDFT",
  secrecy: false,
  ownerUserId: null,
  responsibleUserId: null,
};

function response(movements: unknown[]) {
  return new Response(JSON.stringify({
    hits: {
      hits: [{
        _id: "tjdft-process-1",
        _source: {
          id: "tjdft-process-1",
          tribunal: "TJDFT",
          numeroProcesso: "00000000020268070000",
          movimentos,
        },
      }],
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("DataJud court mapping", () => {
  it("recognizes explicit court labels and CNJ numbering without guessing unsupported courts", () => {
    expect(dataJudAliasFromCourt("TJDFT")).toBe("tjdft");
    expect(dataJudAliasFromCourt("TRT da 10ª Região - TRT10")).toBe("trt10");
    expect(dataJudAliasFromCourt("Tribunal Regional Federal - TRF1")).toBe("trf1");
    expect(dataJudAliasFromCourt("TRE-DF")).toBe("tre-dft");
    expect(dataJudAliasFromProcessNumber("0000000-00.2026.8.26.0000")).toBe("tjsp");
    expect(dataJudAliasFromProcessNumber("0000000-00.2026.4.01.0000")).toBe("trf1");
    expect(dataJudAliasFromProcessNumber("not-a-cnj-number")).toBeNull();
  });

  it("keeps movement identity deterministic and sensitive to evidence changes", () => {
    const first = dataJudMovementIdentity("process-1", { codigo: 51, nome: "Juntada", dataHora: "2026-10-01T10:00:00Z" });
    const again = dataJudMovementIdentity("process-1", { codigo: 51, nome: "Juntada", dataHora: "2026-10-01T10:00:00Z" });
    const changed = dataJudMovementIdentity("process-1", { codigo: 51, nome: "Juntada de petição", dataHora: "2026-10-01T10:00:00Z" });
    expect(first).toEqual(again);
    expect(changed.externalId).not.toBe(first.externalId);
  });

  it("orders movements chronologically before incremental ingestion", () => {
    const ordered = orderedDataJudMovements([
      { nome: "B", dataHora: "2026-10-02T10:00:00Z" },
      { nome: "A", dataHora: "2026-10-01T10:00:00Z" },
    ]);
    expect(ordered.map(item => item.nome)).toEqual(["A", "B"]);
  });
});

describe("Court Push safety", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    db.courtCommunication.count.mockReset();
    db.courtCommunication.createMany.mockReset();
    db.courtCommunication.findUniqueOrThrow.mockReset();
    db.userNotification.create.mockReset();
    access.mockReset();
    push.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("never queries a public source for a secret matter", async () => {
    const result = await syncMatterFromDataJud({ ...matter, secrecy: true });
    expect(result.skipped).toBe("secret-matter");
    expect(fetch).not.toHaveBeenCalled();
    expect(db.courtCommunication.createMany).not.toHaveBeenCalled();
  });

  it("bootstraps only the latest movement and creates no deadline", async () => {
    vi.mocked(fetch).mockResolvedValue(response([
      { codigo: 1, nome: "Distribuição", dataHora: "2026-09-01T10:00:00Z" },
      { codigo: 51, nome: "Juntada", dataHora: "2026-10-01T10:00:00Z" },
    ]));
    db.courtCommunication.count.mockResolvedValue(0);
    db.courtCommunication.createMany.mockResolvedValue({ count: 1 });
    db.courtCommunication.findUniqueOrThrow.mockResolvedValue({ id: "communication-1" });

    const result = await syncMatterFromDataJud(matter);
    expect(result.imported).toBe(1);
    const createArg = db.courtCommunication.createMany.mock.calls[0][0];
    expect(createArg.data).toHaveLength(1);
    expect(createArg.data[0].title).toBe("Juntada");
    expect(JSON.stringify(createArg)).not.toContain("Deadline");
    expect(db.userNotification.create).not.toHaveBeenCalled();
  });

  it("deduplicates upstream retries and only notifies authorized responsible users", async () => {
    vi.mocked(fetch).mockResolvedValue(response([
      { codigo: 51, nome: "Juntada", dataHora: "2026-10-01T10:00:00Z" },
    ]));
    db.courtCommunication.count.mockResolvedValue(1);
    db.courtCommunication.createMany.mockResolvedValueOnce({ count: 0 });

    const duplicate = await syncMatterFromDataJud({ ...matter, ownerUserId: "owner" });
    expect(duplicate.imported).toBe(0);
    expect(db.userNotification.create).not.toHaveBeenCalled();

    db.courtCommunication.createMany.mockResolvedValueOnce({ count: 1 });
    db.courtCommunication.findUniqueOrThrow.mockResolvedValue({ id: "communication-2" });
    access.mockResolvedValue(false);

    const blocked = await syncMatterFromDataJud({ ...matter, ownerUserId: "owner" });
    expect(blocked.imported).toBe(1);
    expect(blocked.notified).toBe(0);
    expect(db.userNotification.create).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
