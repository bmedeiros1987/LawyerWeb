import crypto from "node:crypto";
function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return decoded;
}
export function encryptSecret(value: string) {
  const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv("aes-256-gcm",key(),iv);
  const encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]); const tag=cipher.getAuthTag();
  return ["v1",iv.toString("base64url"),tag.toString("base64url"),encrypted.toString("base64url")].join(":");
}
export function decryptSecret(payload:string){
  const [v,iv,t,e]=payload.split(":"); if(v!=="v1"||!iv||!t||!e) throw new Error("Invalid encrypted secret payload");
  const d=crypto.createDecipheriv("aes-256-gcm",key(),Buffer.from(iv,"base64url")); d.setAuthTag(Buffer.from(t,"base64url"));
  return Buffer.concat([d.update(Buffer.from(e,"base64url")),d.final()]).toString("utf8");
}
export const sha256=(value:string)=>crypto.createHash("sha256").update(value).digest("hex");