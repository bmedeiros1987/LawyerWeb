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
