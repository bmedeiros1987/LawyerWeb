import { z } from "zod";
import { desktopJson, failure, ok, sessionMember } from "@/lib/desktop/http";
import { ownerResetPassword } from "@/lib/desktop/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await desktopJson(request, z.object({ password: z.string().min(1).max(128) }).strict());
    const { userId } = await sessionMember();
    await ownerResetPassword(userId, (await params).id, body.password);
    return ok({ reset: true });
  } catch (e) { return failure(e); }
}
