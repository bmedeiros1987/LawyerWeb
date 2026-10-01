const CANDIDATE_STATUSES = new Set(["CANDIDATE", "PENDING_CONFIRMATION"]);

export function deadlineTimelineDetail(
  status: string,
  dueAt: Date | null | undefined,
  formatDate: (date: Date) => string,
): string {
  if (CANDIDATE_STATUSES.has(status)) {
    return dueAt ? `Data candidata: ${formatDate(dueAt)}` : "Data candidata — revisão humana pendente";
  }
  if (status === "CANCELLED") return "Prazo cancelado";
  return dueAt ? `Prazo confirmado: ${formatDate(dueAt)}` : "Prazo confirmado sem data definida";
}

const OPERATIONAL_STATUSES = new Set(["CONFIRMED", "IN_PROGRESS"]);
const HIGH_RISK_LEVELS = new Set(["CRITICAL", "HIGH"]);

export function countsAsHighRiskDeadline(status: string, risk: string): boolean {
  return OPERATIONAL_STATUSES.has(status) && HIGH_RISK_LEVELS.has(risk);
}

export function isOverdueConfirmedDeadline(
  status: string,
  dueAt: Date | null | undefined,
  now: Date,
): boolean {
  return OPERATIONAL_STATUSES.has(status) && Boolean(dueAt && dueAt < now);
}

const CONFIRMED_RECORD_STATUSES = new Set(["CONFIRMED", "IN_PROGRESS", "COMPLETED"]);

export function countsAsConfirmedDeadlineRecord(status: string): boolean {
  return CONFIRMED_RECORD_STATUSES.has(status);
}
