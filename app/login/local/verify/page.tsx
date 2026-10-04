import { localAuthEnabled } from "@/lib/local-auth/mail";
import { PasswordVerification } from "@/components/password-verification";
export const metadata = { title: "Definir senha | LawyerMind", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default function VerifyPage() { return <main className="auth-panel"><div className="login-card"><h1 className="lawyermind-wordmark">LawyerMind</h1>{localAuthEnabled() ? <PasswordVerification/> : <p>O acesso por senha está indisponível no momento. <a href="/login">Voltar para entrar</a></p>}</div></main>; }
