import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const input = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const parsed = input.parse(await request.json());
    const userAgent = request.headers.get("user-agent");
    const platform = /iphone|ipad|ios/i.test(userAgent ?? "") ? "IOS_PWA" : /android/i.test(userAgent ?? "") ? "ANDROID" : "WEB";
    await prisma.pushSubscription.upsert({
      where: { endpoint: parsed.endpoint },
      create: { userId: session.user.id, endpoint: parsed.endpoint, p256dh: parsed.keys.p256dh, auth: parsed.keys.auth, userAgent, platform },
      update: { userId: session.user.id, p256dh: parsed.keys.p256dh, auth: parsed.keys.auth, userAgent, platform },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid subscription" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;
  if (!endpoint) return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  await prisma.pushSubscription.deleteMany({ where: { userId: session.user.id, endpoint } });
  return NextResponse.json({ ok: true });
}
