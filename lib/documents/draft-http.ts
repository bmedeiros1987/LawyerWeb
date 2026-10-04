import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireActiveMembership } from "@/lib/workspace/context";
import { P, requirePermission } from "@/lib/authz/permissions";
import { ZodError } from "zod";
import { DraftError } from "./drafts";

export async function draftViewer(workspaceId: string | null, edit = false) {
  const session = await auth();
  if (!session?.user?.id) throw new DraftError("Unauthorized", 401);
  if (!workspaceId) throw new DraftError("Informe o workspace.", 400);
  await requireActiveMembership(session.user.id, workspaceId);
  const viewer = await requirePermission(session.user.id, workspaceId, P.DOCUMENTS_VIEW);
  if (edit) await requirePermission(session.user.id, workspaceId, P.DOCUMENTS_EDIT);
  return viewer;
}

export async function draftBody(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) throw new DraftError("Origem inválida.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new DraftError("Envie JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new DraftError("JSON inválido.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 500_000) { await reader.cancel(); throw new DraftError("Conteúdo muito grande.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(body); } catch { throw new DraftError("JSON inválido.", 400); }
}

export function draftFailure(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: "Dados inválidos. Verifique os campos e os limites de texto." }, { status: 400 });
  const status = error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : 500;
  // Never echo database errors, document text or field values.
  const message = status === 500 ? "Não foi possível concluir a operação." : error instanceof Error ? error.message : "Solicitação inválida.";
  return NextResponse.json({ error: message }, { status });
}

export const noStore = { headers: { "Cache-Control": "private, no-store" } };
