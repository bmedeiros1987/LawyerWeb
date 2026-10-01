import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sendPushToUser } from "@/lib/push/webpush";

// Self-test for the device: sends ONE generic push to the signed-in user's own subscriptions only.
// It reports what the push service answered. It cannot prove the device displayed it; the person confirms that.
const MIN_INTERVAL_MS = 10_000;
const lastSent = new Map<string, number>(); // best-effort per instance; not a security boundary

export async function POST() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = Date.now();
  if (now - (lastSent.get(userId) ?? 0) < MIN_INTERVAL_MS) {
    return NextResponse.json({ error: "Aguarde alguns segundos antes de testar novamente." }, { status: 429 });
  }
  lastSent.set(userId, now);

  try {
    const result = await sendPushToUser(userId, {
      title: "MBLZ · teste de notificação",
      body: "Se você está vendo isto no aparelho, o push está funcionando.",
      url: "/app/integrations",
      tag: `push-self-test-${now}`,
    });
    return NextResponse.json({
      vapidConfigured: result.reason !== "VAPID_NOT_CONFIGURED",
      reason: result.reason ?? null,
      subscriptions: result.attempted,
      accepted: result.sent,
      failed: result.failed,
      removed: result.removed,
      failureStatusCodes: result.failureStatusCodes,
      note: "accepted = aceito pelo serviço de push do navegador; a exibição no aparelho só é confirmada por quem o está olhando.",
    });
  } catch {
    return NextResponse.json({ error: "Falha ao consultar as assinaturas de push." }, { status: 500 });
  }
}
