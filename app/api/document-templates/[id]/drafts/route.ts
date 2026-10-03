import { NextRequest, NextResponse } from "next/server";
import { draftBody, draftFailure, draftViewer, noStore } from "@/lib/documents/draft-http";
import { draftInput } from "@/lib/documents/draft-format";
import { createDraft } from "@/lib/documents/drafts";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const input = draftInput.parse(await draftBody(request));
    const viewer = await draftViewer(input.workspaceId, true);
    const { id } = await context.params;
    return NextResponse.json({ document: await createDraft(viewer, id, input.name, input.values, input.operationId) }, { status: 201, ...noStore });
  } catch (error) { return draftFailure(error); }
}
