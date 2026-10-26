// Synthetic only: signatures come from the public RFC 8032 test vector, never a real key.
import { describe, expect, it } from "vitest";
import { parsePublicKey, parseSignature, verifySignature } from "@/lib/desktop/minisign";
import { RFC8032_PUBLIC, syntheticSigner } from "./helpers/minisign-fixture";

const message = Buffer.from("pacote sintético LawyerMind");

describe("minisign verification", () => {
  it("fixture really is the RFC 8032 TEST 1 public key", () => {
    expect(syntheticSigner().publicRaw).toBe(RFC8032_PUBLIC);
  });

  it.each([[true, "ED"], [false, "Ed"]])("accepts a valid signature (prehashed=%s)", (prehashed, algorithm) => {
    const s = syntheticSigner(), sig = parseSignature(s.sign(message, { prehashed }).file);
    expect(sig.algorithm).toBe(algorithm);
    expect(verifySignature(parsePublicKey(s.publicKeyFile), sig, { bytes: message })).toBe(true);
  });

  it("accepts the base64-wrapped form used by Tauri for both key and signature", () => {
    const s = syntheticSigner();
    expect(verifySignature(parsePublicKey(s.publicKeyTauri), parseSignature(s.sign(message).tauri), { bytes: message })).toBe(true);
  });

  it("rejects changed bytes, a different key, a forged trusted comment and malformed input", () => {
    const s = syntheticSigner(), key = parsePublicKey(s.publicKeyFile), good = s.sign(message).file;
    expect(verifySignature(key, parseSignature(good), { bytes: Buffer.from("pacote sintético LawyerMinD") })).toBe(false);
    expect(verifySignature(parsePublicKey(syntheticSigner("other").publicKeyFile), parseSignature(good), { bytes: message })).toBe(false);
    expect(verifySignature(key, parseSignature(good.replace("synthetic test signature", "synthetic test signature!")), { bytes: message })).toBe(false);
    expect(() => parseSignature("lixo")).toThrow();
    expect(() => parsePublicKey("untrusted comment: x\nAAAA\n")).toThrow();
  });
});
