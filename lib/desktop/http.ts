// Request helpers for the desktop API (/api/desktop/*).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getActiveMembership } from "@/lib/workspace/context";
import { DesktopError, isDesktop } from "./env";

export const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/** Desktop only, same-origin JSON requests (the proxy already pins Host to loopback). */
export async function desktopJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!isDesktop()) throw new DesktopError("Not found", 404);
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!origin || !host || new URL(origin).host !== host) throw new DesktopError("Origem inválida.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new DesktopError("Envie JSON.", 415);
  const text = await request.text();
  if (text.length > 65_536) throw new DesktopError("Conteúdo muito grande.", 413);
  let body: unknown;
  try { body = JSON.parse(text || "{}"); } catch { throw new DesktopError("Dados inválidos.", 400); }
  return schema.parse(body);
}

export async function sessionMember() {
  const session = await auth();
  if (!session?.user?.id) throw new DesktopError("Entre novamente.", 401);
  const member = await getActiveMembership(session.user.id);
  return { userId: session.user.id, member };
}

export function failure(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: "Confira os dados informados." }, { status: 400, headers: noStore });
  if (error instanceof DesktopError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: noStore });
  console.error("[desktop]", error instanceof Error ? error.message : error);
  return NextResponse.json({ error: "Não foi possível concluir a operação." }, { status: 500, headers: noStore });
}

export const ok = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: noStore });
