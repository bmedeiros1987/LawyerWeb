import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getDisplayPreferences, preferencesInput, resetDisplayPreferences, saveDisplayPreferences } from "@/lib/ui/preferences";

const noStore = { "Cache-Control": "no-store" };

async function userId() { const s = await auth(); return s?.user?.id ?? null; }
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin"), host = request.headers.get("host");
  return Boolean(origin && host && new URL(origin).host === host);
}

export async function GET() {
  const id = await userId();
  if (!id) return NextResponse.json({ error: "Entre novamente." }, { status: 401, headers: noStore });
  return NextResponse.json(await getDisplayPreferences(id), { headers: noStore });
}

export async function PUT(request: Request) {
  const id = await userId();
  if (!id) return NextResponse.json({ error: "Entre novamente." }, { status: 401, headers: noStore });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403, headers: noStore });
  try {
    return NextResponse.json(await saveDisplayPreferences(id, preferencesInput.parse(await request.json())), { headers: noStore });
  } catch (e) {
    if (e instanceof z.ZodError || e instanceof SyntaxError) return NextResponse.json({ error: "Preferência inválida." }, { status: 400, headers: noStore });
    console.error("[preferences]", e); return NextResponse.json({ error: "Não foi possível salvar." }, { status: 500, headers: noStore });
  }
}

export async function DELETE(request: Request) {
  const id = await userId();
  if (!id) return NextResponse.json({ error: "Entre novamente." }, { status: 401, headers: noStore });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403, headers: noStore });
  return NextResponse.json(await resetDisplayPreferences(id), { headers: noStore });
}
