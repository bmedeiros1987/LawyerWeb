import { z } from "zod";
import { cookies } from "next/headers";
import { desktopJson, failure, ok } from "@/lib/desktop/http";
import { COOKIE, SESSION_HOURS, changePassword, login, recoverOwner, revokeToken, setupOwner } from "@/lib/desktop/auth";
import { auth } from "@/auth";
import { DesktopError } from "@/lib/desktop/env";

const email = z.string().trim().max(254);
const password = z.string().min(1).max(128);
const schemas = {
  setup: z.object({ name: z.string().trim().min(1).max(80), email, password, passwordConfirmation: password }).strict(),
  login: z.object({ email, password }).strict(),
  logout: z.object({}).strict(),
  recover: z.object({ email, recoveryKey: z.string().trim().min(10).max(40), password, passwordConfirmation: password }).strict(),
  password: z.object({ current: password, password, passwordConfirmation: password }).strict(),
};

async function setCookie(token: string) {
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: false, path: "/", maxAge: SESSION_HOURS * 3600 });
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await params;
    if (!(action in schemas)) throw new DesktopError("Not found", 404);
    const body = await desktopJson(request, schemas[action as keyof typeof schemas] as z.ZodType<Record<string, string>>);
    if ("passwordConfirmation" in body && body.password !== body.passwordConfirmation) throw new DesktopError("As senhas não conferem.", 400);
    if (action === "setup") {
      const r = await setupOwner({ name: body.name, email: body.email, password: body.password });
      const s = await login(body.email, body.password);
      await setCookie(s.token);
      return ok({ recoveryKey: r.recoveryKey, next: "/app/setup" }, 201);
    }
    if (action === "login") {
      const s = await login(body.email, body.password);
      await setCookie(s.token);
      return ok({ next: "/app" });
    }
    if (action === "logout") {
      const jar = await cookies();
      await revokeToken(jar.get(COOKIE)?.value);
      jar.set(COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
      return ok({ next: "/login" });
    }
    if (action === "recover") {
      const r = await recoverOwner(body.email, body.recoveryKey, body.password);
      return ok({ recoveryKey: r.recoveryKey });
    }
    const session = await auth();
    if (!session?.user?.id) throw new DesktopError("Entre novamente.", 401);
    await changePassword(session.user.id, body.current, body.password);
    return ok({ next: "/login" });
  } catch (e) { return failure(e); }
}
