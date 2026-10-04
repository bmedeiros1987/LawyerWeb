import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { tokenHash } from "@/lib/local-auth/crypto";
import { configuredMailer, localAuthEnabled } from "@/lib/local-auth/mail";
import { drainAuthMail } from "@/lib/local-auth/outbox";
import { authFailure, privateHeaders } from "@/lib/local-auth/http";
export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET, supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied || !timingSafeEqual(Buffer.from(tokenHash(expected)), Buffer.from(tokenHash(supplied)))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  if (!localAuthEnabled()) return NextResponse.json({ error: "Unavailable" }, { status: 503, headers: privateHeaders });
  try { return NextResponse.json({ processed: await drainAuthMail(configuredMailer()) }, { headers: privateHeaders }); }
  catch (error) { return authFailure(error); }
}
