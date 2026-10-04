import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";
import { LoginView } from "@/components/login-view";
import { loginErrorMessage } from "@/lib/login-message";

export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/app");
  const { error } = await searchParams;
  return <LoginView error={loginErrorMessage(error)} action={async () => {
    "use server";
    await signIn("google", { redirectTo: "/app" });
  }}/>;
}
