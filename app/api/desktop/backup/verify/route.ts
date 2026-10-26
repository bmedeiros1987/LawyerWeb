import { z } from "zod";
import { desktopJson, failure, ok, sessionMember } from "@/lib/desktop/http";
import { requireOwner } from "@/lib/desktop/auth";
import { verifyBackup } from "@/lib/desktop/backup";

export async function POST(request: Request) {
  try {
    const body = await desktopJson(request, z.object({ path: z.string().min(1).max(4096) }).strict());
    await requireOwner((await sessionMember()).userId);
    const m = await verifyBackup(body.path);
    return ok({ created_at: m.created_at, app_version: m.app_version, includes_documents: m.includes_documents, counts: m.counts, documents: m.documents, documents_bytes: m.documents_bytes, migrations: m.migrations });
  } catch (e) { return failure(e); }
}
