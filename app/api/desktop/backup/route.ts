import { z } from "zod";
import { desktopJson, failure, ok, sessionMember } from "@/lib/desktop/http";
import { requireOwner } from "@/lib/desktop/auth";
import { createBackup } from "@/lib/desktop/backup";
import { syncMarker } from "@/lib/desktop/sync";

// Whole-installation backup (all workspaces on this computer): owner only.
export async function POST(request: Request) {
  try {
    const body = await desktopJson(request, z.object({ dest: z.string().min(1).max(4096), includeDocuments: z.boolean() }).strict());
    await requireOwner((await sessionMember()).userId);
    const r = await createBackup({ dest: body.dest, includeDocuments: body.includeDocuments });
    return ok({ ...r, syncFolder: syncMarker(r.path) }, 201);
  } catch (e) { return failure(e); }
}
