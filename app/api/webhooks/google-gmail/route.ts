import { OAuth2Client } from "google-auth-library";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncGmailHistory } from "@/lib/google/gmail";

type PubSubPush = {
  message?: { data?: string; messageId?: string; publishTime?: string };
  subscription?: string;
};

export async function POST(request: NextRequest) {
  const audience = process.env.GOOGLE_PUBSUB_AUDIENCE;
  if (!audience) return NextResponse.json({ error: "Pub/Sub audience is not configured" }, { status: 503 });

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer) return NextResponse.json({ error: "Missing Pub/Sub identity token" }, { status: 401 });

  try {
    await new OAuth2Client().verifyIdToken({ idToken: bearer, audience });
  } catch {
    return NextResponse.json({ error: "Invalid Pub/Sub identity token" }, { status: 401 });
  }

  const payload = (await request.json()) as PubSubPush;
  if (!payload.message?.data) return new NextResponse(null, { status: 204 });

  let notification: { emailAddress?: string; historyId?: string };
  try {
    notification = JSON.parse(Buffer.from(payload.message.data, "base64url").toString("utf8"));
  } catch {
    return NextResponse.json({ error: "Invalid Gmail notification" }, { status: 400 });
  }
  if (!notification.emailAddress) return new NextResponse(null, { status: 204 });

  const connections = await prisma.googleGmailConnection.findMany({
    where: { googleEmail: { equals: notification.emailAddress, mode: "insensitive" } },
    select: { id: true },
  });
  for (const connection of connections) await syncGmailHistory(connection.id, notification.historyId);
  return new NextResponse(null, { status: 204 });
}
