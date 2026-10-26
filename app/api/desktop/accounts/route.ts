import { z } from "zod";
import { desktopJson, failure, ok, sessionMember } from "@/lib/desktop/http";
import { createAdditionalAccount } from "@/lib/desktop/auth";

const input = z.object({ name: z.string().trim().min(1).max(80), email: z.string().trim().max(254), password: z.string().min(1).max(128) }).strict();

// Owner creates another local account. The new account starts with no
// workspace and sees nothing until it creates its own or is invited.
export async function POST(request: Request) {
  try {
    const body = await desktopJson(request, input);
    const { userId } = await sessionMember();
    const r = await createAdditionalAccount(userId, body);
    return ok({ userId: r.userId }, 201);
  } catch (e) { return failure(e); }
}
