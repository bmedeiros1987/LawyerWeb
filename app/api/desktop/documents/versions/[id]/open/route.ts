import { z } from "zod";
import { desktopJson, failure, ok } from "@/lib/desktop/http";
import { accessibleVersion } from "@/lib/desktop/access";
import { openWithSystem, workingCopyPath } from "@/lib/desktop/documents";

// Opens the WORKING COPY (never the original) with the system's default program.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await desktopJson(request, z.object({ reveal: z.boolean().optional() }).strict());
    const { member, version } = await accessibleVersion((await params).id);
    const { file } = await workingCopyPath(version.id, member.workspaceId);
    openWithSystem(file, Boolean(body.reveal));
    return ok({ opened: true, path: file });
  } catch (e) { return failure(e); }
}
