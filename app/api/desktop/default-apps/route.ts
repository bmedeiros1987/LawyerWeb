import { z } from "zod";
import { desktopJson, failure, ok, sessionMember } from "@/lib/desktop/http";
import { DesktopError, isDesktop } from "@/lib/desktop/env";
import { defaultAppsInfo, openSystemSettings } from "@/lib/desktop/default-apps";

// Never changes a default app. POST only opens the operating system's own settings page (Windows).
export async function GET() {
  try { if (!isDesktop()) throw new DesktopError("Not found", 404); await sessionMember(); return ok(defaultAppsInfo()); }
  catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    await desktopJson(request, z.object({ action: z.literal("open-system-settings") }).strict());
    await sessionMember();
    return ok({ opened: openSystemSettings() });
  } catch (e) { return failure(e); }
}
