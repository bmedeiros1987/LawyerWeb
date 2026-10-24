// Minisign signature verification (Ed25519, "Ed" and prehashed "ED" with BLAKE2b-512), the
// format used by Tauri's updater. Verification only: this module never holds or creates keys.
import crypto from "node:crypto";

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
const b64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type MinisignKey = { keyId: Buffer; key: crypto.KeyObject };
export type MinisignSignature = { algorithm: "Ed" | "ED"; keyId: Buffer; signature: Buffer; trustedComment: string; globalSignature: Buffer };

function decode(value: string, length: number, what: string): Buffer {
  const text = value.trim();
  if (!b64.test(text)) throw new Error(`${what}: base64 inválido.`);
  const bytes = Buffer.from(text, "base64");
  if (bytes.length !== length) throw new Error(`${what}: tamanho inválido.`);
  return bytes;
}

// Tauri stores both key and signature as base64 of the original minisign text file; accept either form.
function fileText(value: string): string {
  const text = value.trim();
  if (text.startsWith("untrusted comment:")) return text;
  if (!b64.test(text) || text.length > 8192) throw new Error("Formato minisign inválido.");
  return Buffer.from(text, "base64").toString("utf8").trim();
}

export function parsePublicKey(value: string): MinisignKey {
  const lines = fileText(value).split(/\r?\n/);
  if (lines.length !== 2 || !lines[0].startsWith("untrusted comment:")) throw new Error("Chave pública minisign inválida.");
  const raw = decode(lines[1], 42, "Chave pública");
  if (raw.subarray(0, 2).toString("latin1") !== "Ed") throw new Error("Algoritmo da chave pública não suportado.");
  return { keyId: raw.subarray(2, 10), key: crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw.subarray(10, 42)]), format: "der", type: "spki" }) };
}

export function parseSignature(value: string): MinisignSignature {
  const lines = fileText(value).split(/\r?\n/);
  if (lines.length !== 4 || !lines[0].startsWith("untrusted comment:") || !lines[2].startsWith("trusted comment: ")) throw new Error("Assinatura minisign inválida.");
  const raw = decode(lines[1], 74, "Assinatura");
  const algorithm = raw.subarray(0, 2).toString("latin1");
  if (algorithm !== "Ed" && algorithm !== "ED") throw new Error("Algoritmo da assinatura não suportado.");
  return { algorithm, keyId: raw.subarray(2, 10), signature: raw.subarray(10, 74), trustedComment: lines[2].slice("trusted comment: ".length), globalSignature: decode(lines[3], 64, "Assinatura global") };
}

/** `blake2b512` digest of the file (prehashed "ED") or the whole message (legacy "Ed"). */
export function verifySignature(key: MinisignKey, sig: MinisignSignature, message: { blake2b512: Buffer } | { bytes: Uint8Array }): boolean {
  if (!sig.keyId.equals(key.keyId)) return false;
  const signed = sig.algorithm === "ED"
    ? ("blake2b512" in message ? message.blake2b512 : crypto.createHash("blake2b512").update(message.bytes).digest())
    : ("bytes" in message ? Buffer.from(message.bytes) : null);
  if (!signed) return false;
  if (!crypto.verify(null, signed, key.key, sig.signature)) return false;
  return crypto.verify(null, Buffer.concat([sig.signature, Buffer.from(sig.trustedComment, "utf8")]), key.key, sig.globalSignature);
}
