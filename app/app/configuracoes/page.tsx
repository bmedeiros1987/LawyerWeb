import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDisplayPreferences } from "@/lib/ui/preferences";
import { PreferencesForm } from "@/components/ui/preferences-form";
import { UpdatePanel } from "@/components/desktop/update-panel";
import { desktopVersion, isDesktop } from "@/lib/desktop/env";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth(); if (!session?.user?.id) redirect("/login");
  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">Conta</span><h1>Configurações</h1><p>Leitura (tamanho do texto, densidade e tema) e versão do aplicativo. As preferências valem na hora e ficam salvas na sua conta.</p></div></section>
    <PreferencesForm initial={await getDisplayPreferences(session.user.id)}/>
    {isDesktop() && <UpdatePanel installedVersion={desktopVersion()}/>}
  </div>;
}
