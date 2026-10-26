import { z } from "zod";
import { desktopJson, failure, ok, sessionMember } from "@/lib/desktop/http";
import { requireOwner } from "@/lib/desktop/auth";
import { setRoot } from "@/lib/desktop/documents";

export async function POST(request: Request) {
  try {
    const body = await desktopJson(request, z.object({ path: z.string().min(1).max(4096), force: z.boolean().optional() }).strict());
    await requireOwner((await sessionMember()).userId);
    return ok(await setRoot(body.path, Boolean(body.force)));
  } catch (e) { return failure(e); }
}
