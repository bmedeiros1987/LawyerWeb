import { z } from "zod";
import { desktopJson, failure, ok, sessionMember } from "@/lib/desktop/http";
import { DesktopError } from "@/lib/desktop/env";
import { openVersion } from "@/lib/desktop/open";

// Opens the WORKING COPY (never the original) for editing, or a read-only
// temporary copy. Editing and revealing the folder require documents.edit.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await desktopJson(request, z.object({ reveal: z.boolean().optional(), mode: z.enum(["edit", "read"]).default("read") }).strict());
    const { userId, member } = await sessionMember();
    if (!member) throw new DesktopError("Crie ou entre em um workspace primeiro.", 403);
    return ok(await openVersion({ userId, member, versionId: (await params).id, mode: body.mode, reveal: body.reveal }));
  } catch (e) { return failure(e); }
}
