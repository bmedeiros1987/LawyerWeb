import { z } from "zod";
import { desktopJson, failure, ok, sessionMember } from "@/lib/desktop/http";
import { DesktopError } from "@/lib/desktop/env";
import { runPdfTool } from "@/lib/desktop/pdf-tools";

const id = z.string().min(1).max(64);
const pages = z.string().min(1).max(500);
const body = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("rotate"), versionId: id, pages, angle: z.union([z.literal(90), z.literal(180), z.literal(270)]) }).strict(),
  z.object({ tool: z.literal("delete"), versionId: id, pages }).strict(),
  z.object({ tool: z.literal("extract"), versionId: id, pages }).strict(),
  z.object({ tool: z.literal("split"), versionId: id, ranges: z.array(pages).min(1).max(100) }).strict(),
  z.object({ tool: z.literal("merge"), versionIds: z.array(id).min(2).max(20), name: z.string().max(120).optional() }).strict(),
]);

// Page tools on PDF working copies. Needs documents.edit; the result is always a new
// version/document (the original and the source version are never changed).
export async function POST(request: Request) {
  try {
    const req = await desktopJson(request, body);
    const { userId, member } = await sessionMember();
    if (!member) throw new DesktopError("Crie ou entre em um workspace primeiro.", 403);
    return ok(await runPdfTool({ userId, member, request: req }));
  } catch (e) { return failure(e); }
}
