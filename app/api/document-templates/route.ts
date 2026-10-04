import { NextRequest, NextResponse } from "next/server";
import { draftBody, draftFailure, draftViewer, noStore } from "@/lib/documents/draft-http";
import { templateInput } from "@/lib/documents/draft-format";
import { listTemplates, saveTemplate } from "@/lib/documents/drafts";

export async function GET(request: NextRequest) {
  try {
    const viewer = await draftViewer(request.nextUrl.searchParams.get("workspaceId"));
    return NextResponse.json({ templates: await listTemplates(viewer) }, noStore);
  } catch (error) { return draftFailure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const input = templateInput.parse(await draftBody(request));
    const viewer = await draftViewer(input.workspaceId, true);
    return NextResponse.json({ template: await saveTemplate(viewer, input.name, input.body, input.operationId) }, { status: 201, ...noStore });
  } catch (error) { return draftFailure(error); }
}
