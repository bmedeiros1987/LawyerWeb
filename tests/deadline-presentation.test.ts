import { describe, expect, it } from "vitest";
import { countsAsHighRiskDeadline, deadlineTimelineDetail, isOverdueConfirmedDeadline } from "@/lib/deadlines/presentation";

const format = (date: Date) => date.toISOString().slice(0, 10);

describe("deadline timeline presentation", () => {
  it.each(["CANDIDATE", "PENDING_CONFIRMATION"])(
    "nunca apresenta %s como prazo confirmado",
    (status) => {
      const detail = deadlineTimelineDetail(status, new Date("2026-10-10T12:00:00Z"), format);
      expect(detail).toBe("Data candidata: 2026-10-10");
      expect(detail).not.toContain("Prazo confirmado");
    },
  );

  it("mantém prazo confirmado explicitamente distinto", () => {
    expect(deadlineTimelineDetail("CONFIRMED", new Date("2026-10-10T12:00:00Z"), format))
      .toBe("Prazo confirmado: 2026-10-10");
  });

  it("não promove cancelado a prazo confirmado", () => {
    expect(deadlineTimelineDetail("CANCELLED", new Date("2026-10-10T12:00:00Z"), format))
      .toBe("Prazo cancelado");
  });
});


describe("deadline report classification", () => {
  it.each(["CANDIDATE", "PENDING_CONFIRMATION"])(
    "não conta %s como prazo operacional de alto risco",
    (status) => {
      expect(countsAsHighRiskDeadline(status, "CRITICAL")).toBe(false);
      expect(countsAsHighRiskDeadline(status, "HIGH")).toBe(false);
    },
  );

  it.each(["CONFIRMED", "IN_PROGRESS"])(
    "conta %s de risco HIGH/CRITICAL como operacional",
    (status) => {
      expect(countsAsHighRiskDeadline(status, "CRITICAL")).toBe(true);
      expect(countsAsHighRiskDeadline(status, "HIGH")).toBe(true);
      expect(countsAsHighRiskDeadline(status, "NORMAL")).toBe(false);
    },
  );
});


describe("deadline overdue classification", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const past = new Date("2026-10-09T12:00:00Z");
  const future = new Date("2026-10-11T12:00:00Z");

  it.each(["CANDIDATE", "PENDING_CONFIRMATION"])(
    "nunca chama %s de vencido, mesmo com data candidata no passado",
    (status) => {
      expect(isOverdueConfirmedDeadline(status, past, now)).toBe(false);
    },
  );

  it.each(["CONFIRMED", "IN_PROGRESS"])(
    "mantém %s passado visível como vencido",
    (status) => {
      expect(isOverdueConfirmedDeadline(status, past, now)).toBe(true);
      expect(isOverdueConfirmedDeadline(status, future, now)).toBe(false);
    },
  );

  it("não marca prazo concluído como vencido", () => {
    expect(isOverdueConfirmedDeadline("COMPLETED", past, now)).toBe(false);
  });
});
