import { DeadlineRisk } from "@/generated/prisma/client";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function deadlineRisk(dueAt: Date | null, now = new Date()): DeadlineRisk {
  if (!dueAt) return "ATTENTION";
  const left = dueAt.getTime() - now.getTime();
  if (left <= 0) return "CRITICAL";
  if (left <= 12 * HOUR) return "CRITICAL";
  if (left <= 2 * DAY) return "HIGH";
  if (left <= 5 * DAY) return "ATTENTION";
  return "NORMAL";
}

export function validateDeadlineDates(dueAt: Date, internalDueAt: Date | null) {
  if (Number.isNaN(dueAt.getTime())) throw new Error("Invalid legal due date");
  if (internalDueAt && Number.isNaN(internalDueAt.getTime())) throw new Error("Invalid internal due date");
  if (internalDueAt && internalDueAt.getTime() >= dueAt.getTime()) {
    throw new Error("Internal due date must be before legal due date");
  }
}

export function reminderPlan(dueAt: Date, internalDueAt: Date | null, now = new Date()) {
  const anchors = [
    { stage: 1, at: new Date(dueAt.getTime() - 7 * DAY), channel: "IN_APP" },
    { stage: 2, at: new Date(dueAt.getTime() - 3 * DAY), channel: "IN_APP" },
    { stage: 3, at: new Date(dueAt.getTime() - DAY), channel: "PUSH" },
    { stage: 4, at: new Date(dueAt.getTime() - 6 * HOUR), channel: "PUSH" },
    { stage: 5, at: new Date(dueAt.getTime() - 2 * HOUR), channel: "ESCALATION" },
  ];
  if (internalDueAt) anchors.unshift({ stage: 0, at: internalDueAt, channel: "IN_APP" });
  return anchors.filter((x) => x.at.getTime() > now.getTime());
}
