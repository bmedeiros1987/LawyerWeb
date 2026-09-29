import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { WorkspaceSetupForm } from "@/components/workspace-setup-form";

export const dynamic = "force-dynamic";

export default async function WorkspaceSetupPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: session.user.id, status: "ACTIVE" },
    select: { id: true },
  });
  if (membership) redirect("/app");

  return <div className="setup-page">
    <section className="setup-card">
      <span className="eyebrow">Primeiro acesso</span>
      <h1>Vamos configurar seu espaço jurídico.</h1>
      <p>O MBLZ se adapta à estrutura do escritório. Você começa com perfis e proteção de prazos prontos, mas pode ajustar tudo depois.</p>
      <WorkspaceSetupForm/>
      <div className="setup-foot">
        <strong>O que é criado automaticamente</strong>
        <span>Perfis de equipe · política de prazo com dupla revisão · auditoria · fuso Brasília</span>
      </div>
    </section>
  </div>;
}
