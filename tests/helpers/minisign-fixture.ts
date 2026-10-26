// Synthetic minisign signer for tests only. It uses the PUBLISHED RFC 8032 section 7.1 "TEST 1" Ed25519
// key pair (a public test vector, worthless for anything real). No key is generated and none is production.
import crypto from "node:crypto";

const SEED = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
export const RFC8032_PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const OTHER_SEED = Buffer.from("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb", "hex"); // RFC 8032 TEST 2
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI = Buffer.from("302a300506032b6570032100", "hex");

function material(seed: Buffer) {
  const priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: "der", type: "pkcs8" });
  const pub = crypto.createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(SPKI.length);
  return { priv, pub };
}

export function syntheticSigner(which: "primary" | "other" = "primary") {
  const { priv, pub } = material(which === "primary" ? SEED : OTHER_SEED);
  const keyId = Buffer.from(which === "primary" ? "0102030405060708" : "a1a2a3a4a5a6a7a8", "hex");
  const publicKeyFile = `untrusted comment: synthetic test key\n${Buffer.concat([Buffer.from("Ed"), keyId, pub]).toString("base64")}\n`;
  return {
    publicKeyFile,
    publicKeyTauri: Buffer.from(publicKeyFile).toString("base64"), // Tauri stores the file as base64
    publicRaw: pub.toString("hex"),
    sign(message: Uint8Array, opts: { prehashed?: boolean; trustedComment?: string } = {}) {
      const prehashed = opts.prehashed ?? true, trusted = opts.trustedComment ?? "synthetic test signature";
      const signed = prehashed ? crypto.createHash("blake2b512").update(message).digest() : Buffer.from(message);
      const signature = crypto.sign(null, signed, priv);
      const global = crypto.sign(null, Buffer.concat([signature, Buffer.from(trusted)]), priv);
      const file = `untrusted comment: synthetic\n${Buffer.concat([Buffer.from(prehashed ? "ED" : "Ed"), keyId, signature]).toString("base64")}\ntrusted comment: ${trusted}\n${global.toString("base64")}\n`;
      return { file, tauri: Buffer.from(file).toString("base64") };
    },
  };
}
