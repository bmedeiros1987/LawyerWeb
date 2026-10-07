import { z } from "zod";
import { desktopJson, failure, ok, sessionMember } from "@/lib/desktop/http";
import { requireOwner } from "@/lib/desktop/auth";
import { checkRoot } from "@/lib/desktop/documents";

export async function POST(request: Request) {
  try {
    const body = await desktopJson(request, z.object({ path: z.string().min(1).max(4096) }).strict());
    await requireOwner((await sessionMember()).userId);
    return ok(await checkRoot(body.path));
  } catch (e) { return failure(e); }
}
