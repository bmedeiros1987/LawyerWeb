import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Session } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { COOKIE, currentDesktopSession, revokeToken } from "@/lib/desktop/auth";

const nextAuth = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [Google({
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
    authorization: { params: { scope: "openid email profile", prompt: "select_account" } },
  })],
  pages: { signIn: "/login" },
  callbacks: { async session({ session, user }) { if (session.user) session.user.id = user.id; return session; } },
});

// The desktop app (MBLZ_DESKTOP=1) authenticates offline with local accounts
// (lib/desktop/auth.ts); the web deployment keeps Google sign-in unchanged.
const desktop = () => process.env.MBLZ_DESKTOP === "1";

export const handlers = nextAuth.handlers;
export const signIn = nextAuth.signIn;

export async function auth(): Promise<Session | null> {
  return desktop() ? currentDesktopSession() : nextAuth.auth();
}

export async function signOut(options: { redirectTo: string }) {
  if (!desktop()) return nextAuth.signOut(options);
  const jar = await cookies();
  await revokeToken(jar.get(COOKIE)?.value);
  jar.set(COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  redirect(options.redirectTo);
}
