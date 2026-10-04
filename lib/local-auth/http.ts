import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { localAuthEnabled } from "./mail";
import { LocalAuthError } from "./errors";

export const emailInput = z.string().trim().toLowerCase().email().max(254);
export const loginInput = z.object({ email: emailInput, password: z.string().min(1).max(128) }).strict();
export const beginInput = z.object({ email: emailInput }).strict();
export const finishInput = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), purpose: z.enum(["REGISTER", "RESET"]),
  password: z.string().min(12).max(128), passwordConfirmation: z.string().min(12).max(128),
  name: z.string().trim().min(1).max(80).optional(),
}).strict().refine(input => input.password === input.passwordConfirmation, "As senhas devem ser iguais.");

export async function authBody(request: NextRequest) {
  if (!localAuthEnabled()) throw new LocalAuthError("Acesso por senha indisponível no momento.", 503);
  let origin: URL;
  try { origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? ""); } catch { throw new LocalAuthError("Acesso por senha indisponível no momento.", 503); }
  if (process.env.NODE_ENV === "production" && origin.protocol !== "https:") throw new LocalAuthError("Acesso por senha indisponível no momento.", 503);
  if (request.headers.get("origin") !== origin.origin) throw new LocalAuthError("Origem inválida.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new LocalAuthError("Envie JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new LocalAuthError("Dados inválidos.", 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 16_384) { await reader.cancel(); throw new LocalAuthError("Conteúdo muito grande.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new LocalAuthError("Dados inválidos.", 400); }
}

export const privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export function authFailure(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: "Confira os dados e os limites dos campos." }, { status: 400, headers: privateHeaders });
  const status = error instanceof LocalAuthError ? error.status : 503;
  const message = error instanceof LocalAuthError ? error.message : "Não foi possível concluir o acesso. Tente novamente.";
  return NextResponse.json({ error: message }, { status, headers: { ...privateHeaders, ...(status === 429 ? { "Retry-After": "900" } : {}) } });
}
