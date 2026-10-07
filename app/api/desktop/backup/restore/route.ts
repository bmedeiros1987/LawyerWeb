import { z } from "zod";
import { cookies } from "next/headers";
import { desktopJson, failure, ok, sessionMember } from "@/lib/desktop/http";
import { COOKIE, requireOwner } from "@/lib/desktop/auth";
import { restoreBackup } from "@/lib/desktop/backup";

// Replaces ALL local data with the backup's: owner only, explicit confirmation.
export async function POST(request: Request) {
  try {
    const body = await desktopJson(request, z.object({ path: z.string().min(1).max(4096), documentsTarget: z.string().max(4096).nullish(), confirmation: z.literal("RESTAURAR") }).strict());
    await requireOwner((await sessionMember()).userId);
    const r = await restoreBackup({ file: body.path, documentsTarget: body.documentsTarget });
    (await cookies()).set(COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
    return ok({ ...r, next: "/login" });
  } catch (e) { return failure(e); }
}
