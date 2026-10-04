import { NextRequest, NextResponse } from "next/server";
import { draftFailure, draftViewer } from "@/lib/documents/draft-http";
import { DraftError, readDraft } from "@/lib/documents/drafts";
import { exportSavedVersion } from "@/lib/documents/export-format";
export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await draftViewer(request.nextUrl.searchParams.get("workspaceId"));
    const version = request.nextUrl.searchParams.get("version"), format = request.nextUrl.searchParams.get("format");
    if (!version || !/^[1-9][0-9]{0,6}$/.test(version) || (format !== "pdf" && format !== "docx")) throw new DraftError("Informe a versão salva e o formato PDF ou DOCX.", 400);
    const saved = await readDraft(viewer, (await context.params).id, Number(version));
    if (!saved.body || !saved.sha256) throw new DraftError("Salve o texto antes de exportar.", 409);
    const bytes = await exportSavedVersion({ body: saved.body, version: saved.version, sha256: saved.sha256 }, format);
    return new NextResponse(new Uint8Array(bytes).buffer, { headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="documento-v${saved.version}.${format}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Document-Version": String(saved.version), "X-Document-SHA256": saved.sha256,
    } });
  } catch (error) { const response = draftFailure(error); response.headers.set("Cache-Control", "private, no-store"); return response; }
}
