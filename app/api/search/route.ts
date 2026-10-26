import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getActiveMembership } from "@/lib/workspace/context";
import { globalSearch, SEARCH_KINDS, type SearchKind } from "@/lib/search/global";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

// GET /api/search?q=texto&kinds=clients,matters,documents,content&limit=8
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Entre novamente." }, { status: 401, headers: noStore });
  const member = await getActiveMembership(session.user.id);
  if (!member || member.status !== "ACTIVE") return NextResponse.json({ error: "Crie ou entre em um workspace primeiro." }, { status: 403, headers: noStore });
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const kinds = (url.searchParams.get("kinds") ?? "").split(",").filter((k): k is SearchKind => (SEARCH_KINDS as string[]).includes(k));
  const limit = Number(url.searchParams.get("limit") ?? 8) || 8;
  try {
    return NextResponse.json(await globalSearch(member, q, { kinds, limit }), { headers: noStore });
  } catch (e) {
    console.error("[search]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "A busca falhou. Tente novamente." }, { status: 500, headers: noStore });
  }
}
