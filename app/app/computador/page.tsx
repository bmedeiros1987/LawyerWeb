import path from "node:path";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { desktopStateDir, desktopVersion, isDesktop } from "@/lib/desktop/env";
import { isOwner, listAccounts } from "@/lib/desktop/auth";
import { documentsRoot } from "@/lib/desktop/settings";
import { checkRoot } from "@/lib/desktop/documents";
import { DesktopComputer } from "@/components/desktop/computer";

export const dynamic = "force-dynamic";

export default async function ComputerPage() {
  if (!isDesktop()) notFound();
  const session = await auth(); if (!session?.user?.id) redirect("/login");
  const owner = await isOwner(session.user.id);
  const state = desktopStateDir();
  const root = await documentsRoot();
  return <DesktopComputer
    owner={owner} version={desktopVersion()}
    databaseDir={path.join(state, "pgdata")} backupsDir={path.join(state, "backups")} documentsRoot={root}
    check={owner ? await checkRoot(root) : null}
    accounts={owner ? (await listAccounts()).map(a => ({ ...a, created_at: a.created_at.toISOString(), me: a.user_id === session.user!.id })) : []}
  />;
}
