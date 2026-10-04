import { prisma } from "@/lib/prisma";
import { hashPassword, newToken, tokenHash, tokenPattern, verifyPassword } from "./crypto";
import { invalidChallenge, invalidCredentials, LocalAuthError } from "./errors";
import { type AuthMailer, type Purpose, localAuthEnabled } from "./mail";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
const expired = (date: Date) => date.getTime() <= Date.now();

export async function rateLimit(category: string, identity: string, limit: number, seconds: number) {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const id = tokenHash(JSON.stringify([category, identity, bucket]));
  const row = await prisma.localAuthRateLimit.upsert({ where: { id },
    create: { id, attempts: 1, expiresAt: new Date((bucket + 1) * seconds * 1000) }, update: { attempts: { increment: 1 } },
  });
  if (row.attempts > limit) throw new LocalAuthError("Muitas tentativas. Aguarde antes de tentar novamente.", 429);
}

export async function beginChallenge(emailInput: string, purpose: Purpose, deliver: AuthMailer) {
  const email = normalizeEmail(emailInput);
  await rateLimit("mail-global", "global", 60, 3600);
  await rateLimit("mail-address", email, 3, 900);
  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, include: { localCredential: true } });
  if ((purpose === "REGISTER" && user) || (purpose === "RESET" && (!user?.localCredential || !user.emailVerified || user.localCredential.emailNormalized !== email))) return;
  const token = newToken(), digest = tokenHash(token), id = tokenHash(JSON.stringify([purpose, email]));
  await prisma.localAuthChallenge.upsert({ where: { id },
    create: { id, email, purpose, tokenHash: digest, userId: purpose === "RESET" ? user!.id : null, expiresAt: new Date(Date.now() + 15 * 60_000) },
    update: { tokenHash: digest, userId: purpose === "RESET" ? user!.id : null, expiresAt: new Date(Date.now() + 15 * 60_000) },
  });
  try { await deliver({ email, purpose, token }); }
  catch {
    await prisma.localAuthChallenge.deleteMany({ where: { id, tokenHash: digest } });
    // Same public response for eligible/unknown accounts and delivery failures; never log token/email.
  }
}

export async function finishChallenge(input: { token: string; purpose: Purpose; password: string; name?: string }) {
  if (!tokenPattern.test(input.token)) throw invalidChallenge();
  await rateLimit("finish-global", "global", 30, 60);
  const digest = tokenHash(input.token);
  const initial = await prisma.localAuthChallenge.findUnique({ where: { tokenHash: digest } });
  if (!initial || initial.purpose !== input.purpose || expired(initial.expiresAt)) throw invalidChallenge();
  await rateLimit("finish-address", initial.email, 5, 900);
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "LocalAuthChallenge" WHERE id=${initial.id} FOR UPDATE`;
      const challenge = await tx.localAuthChallenge.findUnique({ where: { id: initial.id } });
      if (!challenge || challenge.tokenHash !== digest || challenge.purpose !== input.purpose || expired(challenge.expiresAt)) throw invalidChallenge();
      let userId: string;
      if (input.purpose === "REGISTER") {
        if (!input.name?.trim() || input.name.trim().length > 80 || challenge.userId) throw invalidChallenge();
        const existing = await tx.user.findFirst({ where: { email: { equals: challenge.email, mode: "insensitive" } } });
        if (existing) throw invalidChallenge();
        const user = await tx.user.create({ data: { email: challenge.email, name: input.name.trim(), emailVerified: new Date(),
          localCredential: { create: { emailNormalized: challenge.email, passwordHash, verifiedAt: new Date() } },
        } });
        userId = user.id;
      } else {
        if (!challenge.userId) throw invalidChallenge();
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${challenge.userId} FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: challenge.userId }, include: { localCredential: true } });
        if (!user?.localCredential || !user.emailVerified || normalizeEmail(user.email ?? "") !== challenge.email || user.localCredential.emailNormalized !== challenge.email) throw invalidChallenge();
        userId = user.id;
        await tx.localCredential.update({ where: { userId }, data: { passwordHash } });
        await tx.localSession.deleteMany({ where: { userId } });
        await tx.session.deleteMany({ where: { userId } });
      }
      await tx.localAuthChallenge.delete({ where: { id: challenge.id } });
      return { userId };
    });
  } catch (error) {
    // Includes normalized-email unique-index conflicts with simultaneous local/Google creation.
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw invalidChallenge();
    throw error;
  }
}

export async function passwordLogin(emailInput: string, password: string, previousLocalToken?: string, previousGoogleTokens: string[] = []) {
  const email = normalizeEmail(emailInput);
  await rateLimit("login-global", "global", 30, 60);
  await rateLimit("login-address", email, 5, 900);
  const candidate = await prisma.localCredential.findUnique({ where: { emailNormalized: email }, include: { user: true } });
  const matches = await verifyPassword(password, candidate?.passwordHash ?? null);
  if (!matches || !candidate || !candidate.user.emailVerified || normalizeEmail(candidate.user.email ?? "") !== email) throw invalidCredentials();
  const token = newToken(), expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${candidate.userId} FOR UPDATE`;
    const current = await tx.localCredential.findUnique({ where: { userId: candidate.userId }, include: { user: true } });
    if (!current || current.passwordHash !== candidate.passwordHash || !current.user.emailVerified || normalizeEmail(current.user.email ?? "") !== email || current.emailNormalized !== email) throw invalidCredentials();
    if (previousLocalToken && tokenPattern.test(previousLocalToken)) await tx.localSession.deleteMany({ where: { tokenHash: tokenHash(previousLocalToken) } });
    if (previousGoogleTokens.length) await tx.session.deleteMany({ where: { sessionToken: { in: previousGoogleTokens } } });
    await tx.localSession.create({ data: { tokenHash: tokenHash(token), userId: candidate.userId, expiresAt } });
  });
  return { token, expiresAt };
}

export async function readLocalSession(token: string) {
  if (!localAuthEnabled() || !tokenPattern.test(token)) return null;
  const session = await prisma.localSession.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: { include: { localCredential: true } } } });
  if (!session || expired(session.expiresAt) || !session.user.localCredential || !session.user.emailVerified || session.user.localCredential.emailNormalized !== normalizeEmail(session.user.email ?? "")) return null;
  return { user: { id: session.userId, name: session.user.name, email: session.user.email, image: session.user.image }, expires: session.expiresAt.toISOString() };
}

export async function revokeLocalSession(token?: string) {
  if (token && tokenPattern.test(token)) await prisma.localSession.deleteMany({ where: { tokenHash: tokenHash(token) } });
}

export async function revokeBrowserSessions(localToken?: string, googleTokens: string[] = []) {
  await prisma.$transaction(async tx => {
    if (localToken && tokenPattern.test(localToken)) await tx.localSession.deleteMany({ where: { tokenHash: tokenHash(localToken) } });
    if (googleTokens.length) await tx.session.deleteMany({ where: { sessionToken: { in: googleTokens } } });
  });
}
