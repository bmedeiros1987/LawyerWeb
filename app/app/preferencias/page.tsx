import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDisplayPreferences } from "@/lib/ui/preferences";
import { PreferencesForm } from "@/components/ui/preferences-form";

export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
  const session = await auth(); if (!session?.user?.id) redirect("/login");
  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">Conta</span><h1>Preferências de leitura</h1><p>Tamanho do texto, densidade e tema. As alterações valem na hora e ficam salvas na sua conta.</p></div></section>
    <PreferencesForm initial={await getDisplayPreferences(session.user.id)}/>
  </div>;
}
