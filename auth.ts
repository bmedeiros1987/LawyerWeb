import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { readLocalSession, revokeLocalSession } from "@/lib/local-auth/service";
import { googleCookieNames, localCookieName, localCookieOptions } from "@/lib/local-auth/cookies";

const googleAuth = NextAuth({
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

export const handlers = googleAuth.handlers;

export async function auth(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(localCookieName())?.value;
  const hasGoogle = googleCookieNames.some(name => jar.get(name)?.value);
  if (token) {
    const local = await readLocalSession(token);
    if (!local) return null; // Never silently switch an expired local identity to a different Google account.
    if (hasGoogle) {
      const google = await googleAuth.auth();
      if (google?.user?.id && google.user.id !== local.user.id) return null;
    }
    return local;
  }
  return hasGoogle ? googleAuth.auth() : null;
}

async function clearLocal() {
  const jar = await cookies();
  await revokeLocalSession(jar.get(localCookieName())?.value);
  jar.set(localCookieName(), "", { ...localCookieOptions(), maxAge: 0 });
}

export async function signIn(provider: "google", options: { redirectTo: string }) {
  await clearLocal();
  return googleAuth.signIn(provider, options);
}

export async function signOut(options: { redirectTo: string }) {
  await clearLocal();
  const jar = await cookies();
  if (googleCookieNames.some(name => jar.get(name)?.value)) return googleAuth.signOut(options);
  redirect(options.redirectTo);
}
