import nodemailer from "nodemailer";
import { z } from "zod";
import { LocalAuthError } from "./errors";

export type Purpose = "REGISTER" | "RESET";
export type AuthMail = { email: string; purpose: Purpose; token: string };
export type AuthMailer = (mail: AuthMail) => Promise<void>;
export const localAuthEnabled = () => process.env.AUTH_LOCAL_ENABLED === "true";

function config() {
  const { AUTH_SMTP_HOST: host, AUTH_SMTP_USER: user, AUTH_SMTP_PASSWORD: pass, AUTH_MAIL_FROM: from, NEXT_PUBLIC_APP_URL: appUrl } = process.env;
  const port = Number(process.env.AUTH_SMTP_PORT ?? "465");
  let origin: URL;
  try { origin = new URL(appUrl ?? ""); } catch { throw new LocalAuthError("Cadastro e recuperação de senha indisponíveis no momento.", 503); }
  if (!host || !user || !pass || !z.email().safeParse(from).success || ![465, 587].includes(port) || origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new LocalAuthError("Cadastro e recuperação de senha indisponíveis no momento.", 503);
  }
  return { host, user, pass, from: from!, port, origin: origin.origin };
}

export function configuredMailer(): AuthMailer {
  const settings = config(); // Fail before any account lookup, including unknown addresses.
  return async ({ email, purpose, token }) => {
    const transport = nodemailer.createTransport({
      host: settings.host, port: settings.port, secure: settings.port === 465, requireTLS: true,
      auth: { user: settings.user, pass: settings.pass },
      tls: { rejectUnauthorized: true }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
      logger: false, debug: false,
    });
    // Fragment is never sent in HTTP requests or referrer headers. The client removes it after reading.
    const link = `${settings.origin}/login/local/verify#purpose=${purpose}&token=${token}`;
    await transport.sendMail({ from: settings.from, to: email,
      subject: purpose === "REGISTER" ? "LawyerMind — confirme seu e-mail" : "LawyerMind — redefina sua senha",
      text: `Use este link para ${purpose === "REGISTER" ? "confirmar seu e-mail e escolher sua senha" : "escolher uma nova senha"}:\n\n${link}\n\nO link expira em 15 minutos e só pode ser usado uma vez. Se você não solicitou esta ação, ignore esta mensagem.`,
    });
  };
}
