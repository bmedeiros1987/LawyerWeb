import { NextResponse } from "next/server";
import { isDesktop, desktopVersion } from "@/lib/desktop/env";
import { accountCount } from "@/lib/desktop/auth";

// Readiness probe used by the desktop shell (no personal data).
export async function GET() {
  if (!isDesktop()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({ ready: true, version: desktopVersion(), hasAccounts: (await accountCount()) > 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ready: false, error: e instanceof Error ? e.message : "erro" }, { status: 503 });
  }
}
