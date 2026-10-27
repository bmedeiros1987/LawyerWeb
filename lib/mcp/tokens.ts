// Access tokens for the optional, read-only MCP endpoint. A token belongs to ONE user in ONE workspace
// and acts with that user's current permissions on every call. Only a SHA-256 of the secret is stored
// (desktop.local_setting, one row per token, so revoking is a single-row change that takes effect on the
// next call). The secret is shown once, when created. MCP is off until the owner turns it on.
import crypto from "node:crypto";
import { withClient } from "@/lib/desktop/db";
import type { Grant } from "./policy";

const PREFIX = "mcp_token:";
const ENABLED_KEY = "mcp_enabled";
export const SCOPES = ["documents:read"] as const;
export const MAX_TOKENS_PER_USER = 10;
export const DEFAULT_DAYS = 90;
export const MAX_DAYS = 365;

type Row = { id: string; name: string; userId: string; workspaceId: string; hash: string; createdAt: number; expiresAt: number; revokedAt?: number | null; lastUsedAt?: number | null };
export type TokenInfo = Pick<Row, "id" | "name" | "createdAt" | "expiresAt" | "revokedAt" | "lastUsedAt"> & { status: "active" | "expired" | "revoked" };

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const statusOf = (r: Row, now: number): TokenInfo["status"] => (r.revokedAt != null ? "revoked" : r.expiresAt <= now ? "expired" : "active");
const info = (r: Row, now: number): TokenInfo => ({ id: r.id, name: r.name, createdAt: r.createdAt, expiresAt: r.expiresAt, revokedAt: r.revokedAt ?? null, lastUsedAt: r.lastUsedAt ?? null, status: statusOf(r, now) });

export function parseToken(raw: string): { id: string; secret: string } | null {
  const m = /^lmcp_([0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/.exec(raw.trim());
  return m ? { id: m[1], secret: m[2] } : null;
}

async function read(id: string): Promise<Row | null> {
  const r = await withClient(async c => (await c.query<{ value: string }>("select value from desktop.local_setting where key = $1", [PREFIX + id])).rows[0]);
  if (!r) return null;
  try { return JSON.parse(r.value) as Row; } catch { return null; }
}
const write = (row: Row) => withClient(c => c.query(
  `insert into desktop.local_setting (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()`, [PREFIX + row.id, JSON.stringify(row)]));

export async function isMcpEnabled(): Promise<boolean> {
  const r = await withClient(async c => (await c.query<{ value: string }>("select value from desktop.local_setting where key = $1", [ENABLED_KEY])).rows[0]);
  return r?.value === "1";
}
export const setMcpEnabled = (on: boolean) => withClient(c => c.query(
  `insert into desktop.local_setting (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()`, [ENABLED_KEY, on ? "1" : "0"]));

async function rowsOf(userId?: string): Promise<Row[]> {
  const rows = await withClient(async c => (await c.query<{ value: string }>("select value from desktop.local_setting where key like $1", [PREFIX + "%"])).rows);
  const out: Row[] = [];
  for (const r of rows) { try { const row = JSON.parse(r.value) as Row; if (!userId || row.userId === userId) out.push(row); } catch { /* ignore damaged row */ } }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listTokens(userId: string, now = Date.now()): Promise<TokenInfo[]> { return (await rowsOf(userId)).map(r => info(r, now)); }

export class TokenError extends Error { constructor(message: string, public status = 400) { super(message); } }

export async function createToken(input: { userId: string; workspaceId: string; name: string; days?: number }, now = Date.now()) {
  const name = input.name.trim();
  if (!name || name.length > 60) throw new TokenError("Dê um nome de até 60 caracteres ao acesso (ex.: Claude Desktop).");
  const days = Math.min(Math.max(Math.floor(input.days ?? DEFAULT_DAYS), 1), MAX_DAYS);
  const active = (await rowsOf(input.userId)).filter(r => statusOf(r, now) === "active");
  if (active.length >= MAX_TOKENS_PER_USER) throw new TokenError(`Limite de ${MAX_TOKENS_PER_USER} acessos ativos. Revogue algum antes.`, 409);
  const id = crypto.randomBytes(6).toString("hex");
  const secret = crypto.randomBytes(32).toString("base64url");
  await write({ id, name, userId: input.userId, workspaceId: input.workspaceId, hash: sha(secret), createdAt: now, expiresAt: now + days * 86_400_000 });
  return { token: `lmcp_${id}.${secret}`, id, name, expiresAt: now + days * 86_400_000 };
}

/** Revokes a token of this user (or any token when `any`, for the owner). */
export async function revokeToken(id: string, userId: string, any = false, now = Date.now()): Promise<boolean> {
  const row = await read(id);
  if (!row || (!any && row.userId !== userId)) return false;
  if (row.revokedAt == null) await write({ ...row, revokedAt: now });
  return true;
}

export type Verified = { grant: Grant; tokenId: string; name: string };

/** Null for anything wrong, without saying which part: unknown id, wrong secret, expired, revoked or MCP switched off. */
export async function verifyToken(raw: string, now = Date.now()): Promise<Verified | null> {
  const p = parseToken(raw);
  if (!p) return null;
  const row = await read(p.id);
  const given = Buffer.from(sha(p.secret)), want = Buffer.from(row?.hash ?? "0".repeat(64));
  const equal = given.length === want.length && crypto.timingSafeEqual(given, want);
  if (!row || !equal) return null;
  if (!(await isMcpEnabled())) return null;
  if (row.revokedAt != null || row.expiresAt <= now) return null;
  // Remember the last use (at most once a minute) so the owner can spot unused or unexpected access.
  if (!row.lastUsedAt || now - row.lastUsedAt > 60_000) await write({ ...row, lastUsedAt: now });
  return { tokenId: row.id, name: row.name, grant: { id: row.id, userId: row.userId, workspaceId: row.workspaceId, scopes: SCOPES, expiresAt: row.expiresAt, revokedAt: row.revokedAt ?? null } };
}
