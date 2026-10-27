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

/** Revokes a token of this user (or any token when `any`, for the owner).
 * The update is atomic: a concurrent verify/touch can never write an older JSON value over revocation.
 */
export async function revokeToken(id: string, userId: string, any = false, now = Date.now()): Promise<boolean> {
  const changed = await withClient(async c => (await c.query<{ value: string }>(
    `update desktop.local_setting
       set value = jsonb_set(value::jsonb, '{revokedAt}', to_jsonb($2::bigint), true)::text,
           updated_at = now()
     where key = $1
       and ($3::boolean or value::jsonb->>'userId' = $4)
       and value::jsonb->>'revokedAt' is null
     returning value`,
    [PREFIX + id, now, any, userId],
  )).rows[0]);
  if (changed) return true;
  // Preserve idempotent revoke semantics without ever writing a stale row.
  const row = await read(id);
  return Boolean(row && (any || row.userId === userId) && row.revokedAt != null);
}

export type Verified = { grant: Grant; tokenId: string; name: string };

/** Null for anything wrong, without saying which part: unknown id, wrong secret, expired, revoked or MCP switched off. */
export async function verifyToken(raw: string, now = Date.now()): Promise<Verified | null> {
  const p = parseToken(raw);
  if (!p) return null;
  const snapshot = await read(p.id);
  const tokenHash = sha(p.secret);
  const given = Buffer.from(tokenHash), want = Buffer.from(snapshot?.hash ?? "0".repeat(64));
  const equal = given.length === want.length && crypto.timingSafeEqual(given, want);
  if (!snapshot || !equal) return null;

  // Re-check every security-relevant field in ONE atomic statement while touching lastUsedAt.
  // If revoke wins the row lock first, this UPDATE matches zero rows and verification fails;
  // therefore a stale snapshot can never resurrect a revoked token.
  const current = await withClient(async c => (await c.query<{ value: string }>(
    `update desktop.local_setting as t
       set value = case
             when coalesce((t.value::jsonb->>'lastUsedAt')::bigint, 0) = 0
               or $3::bigint - coalesce((t.value::jsonb->>'lastUsedAt')::bigint, 0) > 60000
             then jsonb_set(t.value::jsonb, '{lastUsedAt}', to_jsonb($3::bigint), true)::text
             else t.value
           end,
           updated_at = case
             when coalesce((t.value::jsonb->>'lastUsedAt')::bigint, 0) = 0
               or $3::bigint - coalesce((t.value::jsonb->>'lastUsedAt')::bigint, 0) > 60000
             then now() else t.updated_at end
     where t.key = $1
       and t.value::jsonb->>'hash' = $2
       and t.value::jsonb->>'revokedAt' is null
       and (t.value::jsonb->>'expiresAt')::bigint > $3::bigint
       and exists (
         select 1 from desktop.local_setting e
          where e.key = $4 and e.value = '1'
       )
     returning t.value`,
    [PREFIX + p.id, tokenHash, now, ENABLED_KEY],
  )).rows[0]);
  if (!current) return null;
  let row: Row;
  try { row = JSON.parse(current.value) as Row; } catch { return null; }
  return { tokenId: row.id, name: row.name, grant: { id: row.id, userId: row.userId, workspaceId: row.workspaceId, scopes: SCOPES, expiresAt: row.expiresAt, revokedAt: row.revokedAt ?? null } };
}
