import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getActiveMembership } from "@/lib/workspace/context";
import { memberWithPermission, P } from "@/lib/authz/permissions";
import { versionForMember } from "@/lib/desktop/permissions";
import { DocumentAssistant } from "@/components/document-ai/assistant";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string; versionId: string }> }) {
  if (process.env.MBLZ_DESKTOP !== "1") notFound();
  const { id, versionId } = await params;
  const session = await auth(); if (!session?.user?.id) redirect("/login");
  const member = await getActiveMembership(session.user.id); if (!member) redirect("/app/setup");
  if (!(await memberWithPermission(session.user.id, member.workspaceId, P.DOCUMENTS_VIEW))) notFound();
  const version = await versionForMember(session.user.id, member, versionId, false).catch(() => null);
  if (!version || version.documentId !== id) notFound();
  return <DocumentAssistant documentId={id} versionId={version.id} label={`${version.document.name} · versão ${version.version}`} />;
}
