import { z } from "zod";
import { documentsMember } from "@/lib/desktop/access";
import { desktopJson, failure, ok } from "@/lib/desktop/http";
import { DesktopError, isDesktop } from "@/lib/desktop/env";
import { providerStatus, requestRealReview, savePilotSnapshot } from "@/lib/document-review/store";

const anchor = z.object({ clauseId: z.string().max(40), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), quote: z.string().max(4000), textSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const proposal = z.object({ id: z.string().uuid(), anchor, replacement: z.string().max(4000), reason: z.string().max(5000), status: z.enum(["pending", "accepted", "rejected", "conflict"]) }).strict();
const snapshot = z.object({ format: z.literal("lawyermind-review-pilot-v1"), simulation: z.literal(true), sourceId: z.string().max(40), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), representedParty: z.string().min(1).max(200), objective: z.string().min(1).max(2000), text: z.string().max(15000), textSha256: z.string().regex(/^[a-f0-9]{64}$/), parentSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(), decisions: z.array(proposal).max(32), opinion: z.string().max(30000), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), consent: z.literal(true), reviewId: z.string().uuid(), snapshot }).strict(),
  z.object({ action: z.literal("provider"), consent: z.literal(true) }).strict(),
]);
export async function GET() {
  try { if (!isDesktop()) throw new DesktopError("Not found", 404); await documentsMember(false); return ok(providerStatus); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const body = await desktopJson(request, input);
    const { userId, member } = await documentsMember(true);
    if (body.action === "provider") return await requestRealReview();
    return ok(await savePilotSnapshot(userId, member.workspaceId, body.reviewId, body.snapshot), 201);
  } catch (error) { return failure(error); }
}
