import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { LocalAuthError } from "./errors";

const N = 131_072, r = 8, p = 1, keyLength = 64;
let running = 0;
export const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const newToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export function validPassword(password: string) {
  return password.length >= 12 && password.length <= 128 && Buffer.byteLength(password, "utf8") <= 512;
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (running >= 2) throw new LocalAuthError("Acesso ocupado. Tente novamente em instantes.", 503);
  running++;
  try {
    return await new Promise((resolve, reject) => scrypt(password, salt, keyLength,
      { N, r, p, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
  } finally { running--; }
}

export async function hashPassword(password: string) {
  if (!validPassword(password)) throw new LocalAuthError("Use uma senha entre 12 e 128 caracteres.", 400);
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `$scrypt$v1$${N}$${r}$${p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string | null) {
  if (password.length > 128 || Buffer.byteLength(password, "utf8") > 512) return false;
  const parts = encoded?.split("$");
  const valid = parts?.length === 8 && parts.slice(0, 6).join("$") === `$scrypt$v1$${N}$${r}$${p}` && /^[A-Za-z0-9_-]{22}$/.test(parts[6]) && /^[A-Za-z0-9_-]{86}$/.test(parts[7]);
  const salt = valid ? Buffer.from(parts[6], "base64url") : Buffer.alloc(16);
  const expected = valid ? Buffer.from(parts[7], "base64url") : Buffer.alloc(keyLength);
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected) && Boolean(valid);
}
