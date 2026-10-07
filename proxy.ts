import { NextResponse, type NextRequest } from "next/server";

// Desktop app only (MBLZ_DESKTOP=1): the local server answers solely to its own
// loopback address. Blocks DNS-rebinding and requests from other origins to
// state-changing endpoints. Inert in the web deployment.
// Out of scope for the first desktop delivery and/or dependent on external
// services (Google OAuth/Calendar/Gmail, Telegram, WhatsApp, OpenClaw, Web
// Push, cron webhooks): unavailable in the desktop app, so it never reaches
// the network.
const DESKTOP_BLOCKED = ["/api/auth/", "/api/agent/", "/api/integrations/", "/api/webhooks/", "/api/cron/", "/api/push/", "/app/integrations"];

export function proxy(request: NextRequest) {
  if (process.env.MBLZ_DESKTOP !== "1") return NextResponse.next();
  const port = process.env.PORT ?? "";
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const host = request.headers.get("host") ?? "";
  if (!allowed.has(host)) return new NextResponse("Misdirected request", { status: 421 });
  const pathname = request.nextUrl.pathname;
  if (DESKTOP_BLOCKED.some(p => pathname === p.replace(/\/$/, "") || pathname.startsWith(p))) {
    return new NextResponse("Indisponível no aplicativo desktop", { status: 404 });
  }
  const origin = request.headers.get("origin");
  if (origin && request.method !== "GET" && request.method !== "HEAD") {
    let ok = false;
    try { ok = allowed.has(new URL(origin).host); } catch { ok = false; }
    if (!ok) return new NextResponse("Forbidden origin", { status: 403 });
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  return response;
}
