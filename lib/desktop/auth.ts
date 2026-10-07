// Offline login for the desktop app.
//
// - No Google, no e-mail, no fixed credentials: the first person to open the
//   app on this computer creates the owner account (name, e-mail as login,
//   password). A one-time recovery key is shown once and stored only as a hash.
// - Passwords: scrypt (N=2^17, r=8, p=1), same parameters as the web local-auth
//   proposal (PR #50). Sessions: random 256-bit token in an HttpOnly,
//   SameSite=Strict cookie; only its SHA-256 is stored; 12 h lifetime;
//   revocable. 5 wrong passwords lock the account for 15 minutes.
// - Concurrency: each login attempt is counted (atomically) BEFORE the
//   password is checked, so parallel requests cannot get more than 5 guesses
//   per lock window; a successful login resets the count. A recovery key is
//   consumed by a single conditional UPDATE, so it works exactly once even
//   when two requests use it at the same time.
// - Data isolation is the web app's own model: every account only sees the
//   workspaces it is a member of.
import crypto from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { DesktopError } from "./env";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const N = 131_072, r = 8, p = 1, KEYLEN = 64;
export const SESSION_HOURS = 12;
export const COOKIE = "lawyermind_desktop_session";
const MAX_FAILURES = 5, LOCK_MINUTES = 15;

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

export function validatePassword(pw: string) {
  if (pw.length < 12 || pw.length > 128) throw new DesktopError("Use uma senha entre 12 e 128 caracteres.", 400);
}

export async function hashPassword(pw: string): Promise<string> {
  validatePassword(pw);
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, KEYLEN, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return `$scrypt$v1$${N}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

const DUMMY = "$scrypt$v1$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86);

export async function verifyPassword(pw: string, encoded: string | null): Promise<boolean> {
  const parts = (encoded ?? DUMMY).split("$");
  if (parts.length !== 8 || pw.length > 128) return false;
  const salt = Buffer.from(parts[6], "base64url"), expected = Buffer.from(parts[7], "base64url");
  const actual = await scrypt(pw, salt, expected.length || KEYLEN, { N: Number(parts[3]), r: Number(parts[4]), p: Number(parts[5]), maxmem: 256 * 1024 * 1024 });
  return Boolean(encoded) && actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function newRecoveryKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(25);
  const chars = [...bytes].map(b => alphabet[b % alphabet.length]).join("");
  return chars.match(/.{5}/g)!.join("-");
}

type AccountRow = { user_id: string; email_normalized: string; password_hash: string; is_owner: boolean; failed_attempts: number; locked_until: Date | null };

export async function accountCount(): Promise<number> {
  const r = await prisma.$queryRaw<{ n: bigint }[]>`select count(*) as n from desktop.local_account`;
  return Number(r[0].n);
}

async function createAccount(input: { name: string; email: string; password: string; owner: boolean }) {
  const name = input.name.trim(), email = normalizeEmail(input.email);
  if (!name || name.length > 80) throw new DesktopError("Informe um nome com até 80 caracteres.", 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new DesktopError("Informe um e-mail válido (é usado apenas como login local).", 400);
  const passwordHash = await hashPassword(input.password);
  const recovery = input.owner ? newRecoveryKey() : null;
  try {
    const userId = await prisma.$transaction(async tx => {
      await tx.$executeRaw`select pg_advisory_xact_lock(7311)`;
      if (input.owner) {
        const n = await tx.$queryRaw<{ n: bigint }[]>`select count(*) as n from desktop.local_account`;
        if (Number(n[0].n) > 0) throw new DesktopError("A conta proprietária já foi criada neste computador.", 409);
      }
      const taken = await tx.$queryRaw<{ x: number }[]>`select 1 as x from desktop.local_account where email_normalized = ${email}`;
      if (taken.length) throw new DesktopError("Já existe uma conta com esse e-mail neste computador.", 409);
      const user = await tx.user.create({ data: { name, email, emailVerified: null } });
      await tx.$executeRaw`insert into desktop.local_account (user_id, email_normalized, password_hash, is_owner, recovery_hash)
        values (${user.id}, ${email}, ${passwordHash}, ${input.owner}, ${recovery ? sha256(recovery) : null})`;
      return user.id;
    });
    return { userId, recoveryKey: recovery };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") throw new DesktopError("Já existe um usuário com esse e-mail.", 409);
    throw e;
  }
}

export const setupOwner = (input: { name: string; email: string; password: string }) => createAccount({ ...input, owner: true });

export async function createAdditionalAccount(byUserId: string, input: { name: string; email: string; password: string }) {
  await requireOwner(byUserId);
  return createAccount({ ...input, owner: false });
}

export async function isOwner(userId: string): Promise<boolean> {
  const r = await prisma.$queryRaw<{ o: boolean }[]>`select is_owner as o from desktop.local_account where user_id = ${userId}`;
  return Boolean(r[0]?.o);
}

export async function requireOwner(userId: string) {
  if (!(await isOwner(userId))) throw new DesktopError("Somente a conta proprietária deste computador pode fazer isso.", 403);
}

/**
 * Reserves one attempt for this account: returns false when it is locked.
 * The count is the number of attempts since the last successful login; the
 * attempt that reaches MAX_FAILURES sets the lock. An expired lock starts a
 * new count.
 */
async function reserveAttempt(userId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ ok: boolean }[]>`
    update desktop.local_account set
      failed_attempts = case when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end,
      locked_until = case
        when (case when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end) >= ${MAX_FAILURES}
        then now() + make_interval(mins => ${LOCK_MINUTES}) else null end,
      updated_at = now()
    where user_id = ${userId}
      and (locked_until is null or locked_until <= now())
      and (failed_attempts < ${MAX_FAILURES} or locked_until is not null)
    returning true as ok`;
  return rows.length > 0;
}

export async function login(emailInput: string, password: string): Promise<{ token: string; expiresAt: Date }> {
  const email = normalizeEmail(emailInput);
  const rows = await prisma.$queryRaw<AccountRow[]>`select user_id, email_normalized, password_hash, is_owner, failed_attempts, locked_until from desktop.local_account where email_normalized = ${email}`;
  const acc = rows[0];
  if (acc && !(await reserveAttempt(acc.user_id))) {
    await verifyPassword(password, null);
    throw new DesktopError(`Conta bloqueada temporariamente após tentativas incorretas. Tente novamente em até ${LOCK_MINUTES} minutos.`, 429);
  }
  const ok = await verifyPassword(password, acc?.password_hash ?? null);
  if (!acc || !ok) throw new DesktopError("E-mail ou senha incorretos.", 401);
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await prisma.$transaction([
    prisma.$executeRaw`update desktop.local_account set failed_attempts = 0, locked_until = null, updated_at = now() where user_id = ${acc.user_id}`,
    prisma.$executeRaw`delete from desktop.local_session where expires_at < now()`,
    prisma.$executeRaw`insert into desktop.local_session (token_hash, user_id, expires_at) values (${sha256(token)}, ${acc.user_id}, ${expiresAt})`,
  ]);
  return { token, expiresAt };
}

export async function readSession(token: string | undefined): Promise<Session | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const rows = await prisma.$queryRaw<{ user_id: string; expires_at: Date; name: string | null; email: string | null; image: string | null }[]>`
    select s.user_id, s.expires_at, u.name, u.email, u.image from desktop.local_session s
    join public."User" u on u.id = s.user_id join desktop.local_account a on a.user_id = s.user_id
    where s.token_hash = ${sha256(token)} and s.expires_at > now()`;
  const s = rows[0];
  if (!s) return null;
  return { user: { id: s.user_id, name: s.name, email: s.email, image: s.image }, expires: s.expires_at.toISOString() } as Session;
}

export async function currentDesktopSession(): Promise<Session | null> {
  const jar = await cookies();
  return readSession(jar.get(COOKIE)?.value);
}

export async function revokeToken(token: string | undefined) {
  if (token) await prisma.$executeRaw`delete from desktop.local_session where token_hash = ${sha256(token)}`;
}

export async function revokeAllSessions(userId: string) {
  await prisma.$executeRaw`delete from desktop.local_session where user_id = ${userId}`;
}

export async function changePassword(userId: string, current: string, next: string) {
  const rows = await prisma.$queryRaw<{ h: string }[]>`select password_hash as h from desktop.local_account where user_id = ${userId}`;
  if (!rows[0] || !(await verifyPassword(current, rows[0].h))) throw new DesktopError("Senha atual incorreta.", 401);
  const h = await hashPassword(next);
  await prisma.$executeRaw`update desktop.local_account set password_hash = ${h}, updated_at = now() where user_id = ${userId}`;
  await revokeAllSessions(userId);
}

/** Owner resets the password of another local account (e.g. a colleague forgot it). */
export async function ownerResetPassword(ownerId: string, targetUserId: string, next: string) {
  await requireOwner(ownerId);
  if (ownerId === targetUserId) throw new DesktopError("Para a sua própria senha, use Alterar senha.", 400);
  const h = await hashPassword(next);
  const n = await prisma.$executeRaw`update desktop.local_account set password_hash = ${h}, failed_attempts = 0, locked_until = null, updated_at = now() where user_id = ${targetUserId} and not is_owner`;
  if (!n) throw new DesktopError("Conta não encontrada.", 404);
  await revokeAllSessions(targetUserId);
}

/** Owner forgot the password: the recovery key shown at setup resets it and is rotated. */
export async function recoverOwner(emailInput: string, recoveryKey: string, next: string): Promise<{ recoveryKey: string }> {
  const email = normalizeEmail(emailInput);
  const key = recoveryKey.trim().toUpperCase();
  const rows = await prisma.$queryRaw<{ user_id: string; recovery_hash: string | null }[]>`select user_id, recovery_hash from desktop.local_account where email_normalized = ${email} and is_owner`;
  const expected = rows[0]?.recovery_hash ?? sha256("no-account");
  const ok = rows[0] && crypto.timingSafeEqual(Buffer.from(sha256(key)), Buffer.from(expected));
  if (!ok) { await verifyPassword(next, null); throw new DesktopError("E-mail ou chave de recuperação incorretos.", 401); }
  const h = await hashPassword(next);
  const rotated = newRecoveryKey();
  // Consumes the key only if it is still the current one (one winner under concurrency).
  const n = await prisma.$executeRaw`update desktop.local_account set password_hash = ${h}, recovery_hash = ${sha256(rotated)}, failed_attempts = 0, locked_until = null, updated_at = now()
    where user_id = ${rows[0].user_id} and recovery_hash = ${sha256(key)}`;
  if (n !== 1) throw new DesktopError("Esta chave de recuperação já foi usada. Use a chave nova exibida na recuperação.", 409);
  await revokeAllSessions(rows[0].user_id);
  return { recoveryKey: rotated };
}

export async function listAccounts() {
  return prisma.$queryRaw<{ user_id: string; email: string; name: string | null; is_owner: boolean; created_at: Date; locked: boolean }[]>`
    select a.user_id, a.email_normalized as email, u.name, a.is_owner, a.created_at, coalesce(a.locked_until > now(), false) as locked
    from desktop.local_account a join public."User" u on u.id = a.user_id order by a.created_at`;
}
