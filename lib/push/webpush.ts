import webpush from "web-push";
import { prisma } from "@/lib/prisma";

function configured() {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

export class InvalidVapidConfigurationError extends Error {
  constructor() { super("Invalid VAPID configuration"); }
}

function configure() {
  if (!configured()) return false;
  try { webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  ); } catch { throw new InvalidVapidConfigurationError(); }
  return true;
}

export type PushSendResult = {
  /** Subscriptions whose push service accepted the message (HTTP 2xx). This is NOT proof that a device displayed it. */
  sent: number;
  /** Subscriptions a push was attempted for. */
  attempted: number;
  /** Attempts that failed (rejected by the push service or network error). */
  failed: number;
  /** Expired subscriptions (404/410) that were deleted. */
  removed: number;
  /** True when nothing was attempted. */
  skipped: boolean;
  reason?: "VAPID_NOT_CONFIGURED" | "NO_SUBSCRIPTIONS";
  /** HTTP status codes of failed attempts (no endpoints, keys or payloads). */
  failureStatusCodes: number[];
};

export async function sendPushToUser(userId: string, payload: { title: string; body?: string; url?: string; tag?: string }): Promise<PushSendResult> {
  if (!configure()) return { sent: 0, attempted: 0, failed: 0, removed: 0, skipped: true, reason: "VAPID_NOT_CONFIGURED", failureStatusCodes: [] };
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return { sent: 0, attempted: 0, failed: 0, removed: 0, skipped: true, reason: "NO_SUBSCRIPTIONS", failureStatusCodes: [] };

  let sent = 0, failed = 0, removed = 0;
  const failureStatusCodes: number[] = [];
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60, urgency: "high" },
      );
      sent += 1;
    } catch (error: unknown) {
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        try {
          await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } });
          removed += 1;
        } catch {
          failed += 1;
          failureStatusCodes.push(statusCode);
        }
      } else {
        failed += 1;
        if (typeof statusCode === "number") failureStatusCodes.push(statusCode);
      }
    }
  }
  return { sent, attempted: subscriptions.length, failed, removed, skipped: false, failureStatusCodes };
}
