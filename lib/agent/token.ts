import crypto from "node:crypto";

export const MBLZ_AGENT_SCOPES = [
  "workspace:summary:read",
  "deadlines:read",
] as const;

export type MblzAgentScope = (typeof MBLZ_AGENT_SCOPES)[number];

export type MblzAgentClaims = {
  version: 1;
  userId: string;
  workspaceId: string;
  scopes: MblzAgentScope[];
  iat: number;
  exp: number;
};

const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;

function signingSecret(): string {
  const secret = String(process.env.MBLZ_AGENT_SIGNING_SECRET || "");
  if (secret.length < 32) throw new Error("MBLZ_AGENT_SIGNING_SECRET is not configured");
  return secret;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(input: string): string {
  return crypto.createHmac("sha256", signingSecret()).update(input).digest("base64url");
}

function allowedScope(value: unknown): value is MblzAgentScope {
  return typeof value === "string" && (MBLZ_AGENT_SCOPES as readonly string[]).includes(value);
}

export function createMblzAgentToken(input: {
  userId: string;
  workspaceId: string;
  scopes?: MblzAgentScope[];
  ttlSeconds?: number;
}, nowMs = Date.now()): { token: string; claims: MblzAgentClaims } {
  const userId = String(input.userId || "").trim();
  const workspaceId = String(input.workspaceId || "").trim();
  if (!userId || !workspaceId) throw new Error("Agent identity is incomplete");

  const scopes = [...new Set((input.scopes || [...MBLZ_AGENT_SCOPES]).filter(allowedScope))];
  if (!scopes.length) throw new Error("Agent token requires at least one read scope");

  const ttlSeconds = Math.min(
    MAX_TTL_SECONDS,
    Math.max(60, Math.floor(Number(input.ttlSeconds || 24 * 60 * 60))),
  );
  const iat = Math.floor(nowMs / 1000);
  const claims: MblzAgentClaims = {
    version: 1,
    userId,
    workspaceId,
    scopes,
    iat,
    exp: iat + ttlSeconds,
  };
  const payload = encode(JSON.stringify(claims));
  const signingInput = `v1.${payload}`;
  return { token: `${signingInput}.${sign(signingInput)}`, claims };
}

export function verifyMblzAgentToken(
  token: unknown,
  requiredScope?: MblzAgentScope,
  nowMs = Date.now(),
): MblzAgentClaims {
  const raw = String(token || "").trim();
  const [version, payload, receivedSignature, extra] = raw.split(".");
  if (version !== "v1" || !payload || !receivedSignature || extra) throw new Error("Invalid agent token");

  const signingInput = `${version}.${payload}`;
  const expectedSignature = sign(signingInput);
  const a = Buffer.from(receivedSignature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("Invalid agent token");

  let parsed: unknown;
  try {
    parsed = JSON.parse(decode(payload));
  } catch {
    throw new Error("Invalid agent token");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid agent token");

  const value = parsed as Record<string, unknown>;
  const scopes = Array.isArray(value.scopes) ? value.scopes.filter(allowedScope) : [];
  const claims: MblzAgentClaims = {
    version: value.version === 1 ? 1 : 1,
    userId: String(value.userId || "").trim(),
    workspaceId: String(value.workspaceId || "").trim(),
    scopes,
    iat: Number(value.iat),
    exp: Number(value.exp),
  };
  if (value.version !== 1 || !claims.userId || !claims.workspaceId || !claims.scopes.length) throw new Error("Invalid agent token");
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.exp <= claims.iat) throw new Error("Invalid agent token");

  const now = Math.floor(nowMs / 1000);
  if (claims.iat > now + 60 || claims.exp <= now || claims.exp - claims.iat > MAX_TTL_SECONDS) throw new Error("Expired agent token");
  if (requiredScope && !claims.scopes.includes(requiredScope)) throw new Error("Agent scope denied");
  return claims;
}

export function readMblzAgentBearer(request: Request, requiredScope?: MblzAgentScope): MblzAgentClaims {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Agent authorization required");
  return verifyMblzAgentToken(match[1], requiredScope);
}
