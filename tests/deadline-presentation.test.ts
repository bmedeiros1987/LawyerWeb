import { describe, expect, it } from "vitest";
import { deadlineTimelineDetail } from "@/lib/deadlines/presentation";

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
