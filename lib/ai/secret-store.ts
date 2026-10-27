// Encrypts the provider key at rest (AES-256-GCM) with a key derived from the installation's server
// secret (AUTH_SECRET, which lives in the app data folder, never in the database or a backup of it).
// This keeps the key out of plain text in the database; it does not protect against someone who can
// already read the whole user profile of this computer.
import crypto from "node:crypto";

const INFO = "lawyermind-ai-provider-key-v1";

function derive(secret: string): Buffer {
  if (!secret || secret.length < 16) throw new Error("Segredo da instalação ausente.");
  return Buffer.from(crypto.hkdfSync("sha256", secret, Buffer.alloc(0), INFO, 32));
}

export function sealKey(plain: string, secret: string, aad: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", derive(secret), iv);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

/** Returns null (never throws) when the value is damaged, was sealed for other settings, or the secret changed. */
export function openKey(sealed: string, secret: string, aad: string): string | null {
  try {
    const [v, iv, tag, body] = sealed.split(".");
    if (v !== "v1") return null;
    const d = crypto.createDecipheriv("aes-256-gcm", derive(secret), Buffer.from(iv, "base64"));
    d.setAAD(Buffer.from(aad)); d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
  } catch { return null; }
}
