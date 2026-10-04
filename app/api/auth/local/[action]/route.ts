import { after } from "next/server";
import { queueAuthMail, deliverAuthJob } from "@/lib/local-auth/outbox";
import { NextRequest, NextResponse } from "next/server";
import { authBody, authFailure, beginInput, finishInput, loginInput, privateHeaders } from "@/lib/local-auth/http";
import { finishChallenge, passwordLogin, revokeBrowserSessions, SESSION_SECONDS } from "@/lib/local-auth/service";
import { configuredMailer } from "@/lib/local-auth/mail";
import { googleCookieNames, localCookieName, localCookieOptions } from "@/lib/local-auth/cookies";

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  try {
    const body = await authBody(request);
    const { action } = await context.params;
    if (action === "register" || action === "reset") {
      const input = beginInput.parse(body);
      const mailer = configuredMailer();
      const jobId = await queueAuthMail(input.email, action === "register" ? "REGISTER" : "RESET");
      after(async () => { try { await deliverAuthJob(jobId, mailer); } catch { /* Durable job remains for authenticated retry. */ } });
      return NextResponse.json({ message: "Se o endereço for elegível, você receberá um link por e-mail. Verifique também a caixa de spam." }, { status: 202, headers: privateHeaders });
    }
    if (action === "verify") {
      const input = finishInput.parse(body);
      await finishChallenge(input);
      return NextResponse.json({ message: "Senha definida. Entre com seu e-mail e sua senha." }, { headers: privateHeaders });
    }
    if (action === "login") {
      const input = loginInput.parse(body);
      const previous = googleCookieNames.flatMap(name => request.cookies.get(name)?.value ? [request.cookies.get(name)!.value] : []);
      const session = await passwordLogin(input.email, input.password, request.cookies.get(localCookieName())?.value, previous);
      const response = NextResponse.json({ next: "/app" }, { headers: privateHeaders });
      response.cookies.set(localCookieName(), session.token, { ...localCookieOptions(), maxAge: SESSION_SECONDS });
      for (const name of googleCookieNames) response.cookies.set(name, "", { httpOnly: true, path: "/", sameSite: "lax", secure: name.startsWith("__Secure-"), maxAge: 0 });
      return response;
    }
    if (action === "logout") {
      await revokeBrowserSessions(request.cookies.get(localCookieName())?.value, googleCookieNames.flatMap(name => request.cookies.get(name)?.value ? [request.cookies.get(name)!.value] : []));
      const response = NextResponse.json({ next: "/login" }, { headers: privateHeaders });
      response.cookies.set(localCookieName(), "", { ...localCookieOptions(), maxAge: 0 });
      for (const name of googleCookieNames) response.cookies.set(name, "", { httpOnly: true, path: "/", sameSite: "lax", secure: name.startsWith("__Secure-"), maxAge: 0 });
      return response;
    }
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
  } catch (error) { return authFailure(error); }
}
