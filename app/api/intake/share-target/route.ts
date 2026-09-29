import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/login", request.url), 303);
  const member = await prisma.workspaceMember.findFirst({ where: { userId: session.user.id, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!member) return NextResponse.redirect(new URL("/app?setup=workspace", request.url), 303);

  const form = await request.formData();
  const title = typeof form.get("title") === "string" ? String(form.get("title")) : "";
  const text = typeof form.get("text") === "string" ? String(form.get("text")) : "";
  const url = typeof form.get("url") === "string" ? String(form.get("url")) : "";
  const body = [text, url].filter(Boolean).join("\n\n").trim();

  const demand = await prisma.intakeDemand.create({
    data: {
      workspaceId: member.workspaceId,
      source: "SHARE_TARGET",
      externalId: crypto.randomUUID(),
      title: title.trim() || "Demanda compartilhada",
      bodyPreview: body || null,
      requiresAction: true,
      status: "NEW",
      evidence: { source: "web-share-target", sharedUrl: url || null },
    },
  });
  await prisma.activityLog.create({
    data: {
      workspaceId: member.workspaceId,
      userId: session.user.id,
      type: "DEMAND_SHARED_TO_MBLZ",
      entityType: "IntakeDemand",
      entityId: demand.id,
      summary: "Nova demanda recebida por compartilhamento",
    },
  });
  return NextResponse.redirect(new URL(`/app/inbox?shared=${demand.id}`, request.url), 303);
}
