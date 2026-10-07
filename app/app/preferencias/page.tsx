import { redirect } from "next/navigation";

// Reading preferences moved into Configurações; old links keep working.
export default function PreferencesPage() { redirect("/app/configuracoes"); }
