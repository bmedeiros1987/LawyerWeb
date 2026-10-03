import { NextRequest, NextResponse } from "next/server";
import { draftBody, draftFailure, draftViewer, noStore } from "@/lib/documents/draft-http";
import { revisionInput } from "@/lib/documents/draft-format";
import { DraftError, readDraft, saveRevision } from "@/lib/documents/drafts";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    const viewer = await draftViewer(request.nextUrl.searchParams.get("workspaceId"));
    const { id } = await context.params;
    const raw = request.nextUrl.searchParams.get("version");
    if (raw !== null && !/^[1-9][0-9]{0,6}$/.test(raw)) throw new DraftError("Versão inválida.", 400);
    return NextResponse.json(await readDraft(viewer, id, raw === null ? undefined : Number(raw)), noStore);
  } catch (error) { return draftFailure(error); }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const input = revisionInput.parse(await draftBody(request));
    const viewer = await draftViewer(input.workspaceId, true);
    const { id } = await context.params;
    return NextResponse.json(await saveRevision(viewer, id, input.expectedVersion, input.body, input.operationId), { status: 201, ...noStore });
  } catch (error) { return draftFailure(error); }
}
