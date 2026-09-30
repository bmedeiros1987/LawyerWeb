import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireActiveMembership } from "@/lib/workspace/context";
import { addMatterRecord } from "@/lib/matters/records";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.PROCESS_REGISTER_ENABLED !== "true") return NextResponse.json({ error: "Registro processual ainda não ativado." }, { status: 503 });
  try {
    const member = await requireActiveMembership(session.user.id);
    const { id } = await context.params;
    const result = await addMatterRecord(session.user.id, member.workspaceId, id, await request.json());
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível registrar." }, { status });
  }
}
