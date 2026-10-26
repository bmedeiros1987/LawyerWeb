// The updater PUBLIC key shipped in the app, proven against the REAL Tauri signer's output (throwaway key),
// plus guards that no private signing material enters the repository.
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePublicKey, parseSignature, verifySignature } from "@/lib/desktop/minisign";
import { downloadVerifiedPackage } from "@/lib/desktop/update-download";
import type { UpdatePackage } from "@/lib/desktop/update-manifest";

const FX = path.resolve("tests/fixtures/tauri-signer");
const pkgBytes = fs.readFileSync(path.join(FX, "package.bin"));
const sigText = fs.readFileSync(path.join(FX, "package.bin.sig"), "utf8").trim();
const throwaway = fs.readFileSync(path.join(FX, "throwaway.pub"), "utf8").trim();
const shipped = fs.readFileSync(path.resolve("desktop/src-tauri/updater.pub"), "utf8").trim();
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

describe("verifier vs. the real `tauri signer` output", () => {
  it("accepts the real signature (minisign prehashed 'ED', base64-wrapped like Tauri stores it)", () => {
    const sig = parseSignature(sigText);
    expect(sig.algorithm).toBe("ED");
    expect(sig.trustedComment).toMatch(/file:package\.bin/);
    expect(verifySignature(parsePublicKey(throwaway), sig, { blake2b512: crypto.createHash("blake2b512").update(pkgBytes).digest() })).toBe(true);
  });
  it("rejects changed bytes and a different key (the shipped key did not sign this fixture)", () => {
    const sig = parseSignature(sigText), hash = (b: Buffer) => ({ blake2b512: crypto.createHash("blake2b512").update(b).digest() });
    expect(verifySignature(parsePublicKey(throwaway), sig, hash(Buffer.concat([pkgBytes, Buffer.from("x")])))).toBe(false);
    expect(verifySignature(parsePublicKey(shipped), sig, hash(pkgBytes))).toBe(false);
  });
  it("the download path installs nothing but verifies end to end with the real format", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-key-"));
    try {
      const pkg: UpdatePackage = { target: "windows-x86_64", name: "LawyerMind_0.2.0_x64-setup.exe", url: "https://github.com/bmedeiros1987/LawyerWeb/releases/download/v0.2.0/LawyerMind_0.2.0_x64-setup.exe", size: pkgBytes.length, sha256: sha(pkgBytes), signature: sigText };
      const fetcher = (async () => new Response(pkgBytes, { headers: { "content-length": String(pkgBytes.length) } })) as typeof fetch;
      expect((await downloadVerifiedPackage({ pkg, tag: "v0.2.0", publicKey: throwaway, stagingRoot: dir, fetcher })).signatureVerified).toBe(true);
      // The same package against the PRODUCTION public key must be refused: it was not signed by it.
      await expect(downloadVerifiedPackage({ pkg: { ...pkg, name: "other-setup.exe" }, tag: "v0.2.0", publicKey: shipped, stagingRoot: dir, fetcher })).rejects.toMatchObject({ code: "signature-key" });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("the key shipped with the app", () => {
  it("is a valid minisign public key and is not the throwaway test key", () => {
    const a = parsePublicKey(shipped), b = parsePublicKey(throwaway);
    expect(a.keyId.length).toBe(8); expect(a.keyId.equals(b.keyId)).toBe(false);
  });
  it("is handed to the local server by the shell, from that file", () => {
    const rs = fs.readFileSync("desktop/src-tauri/src/server.rs", "utf8");
    expect(rs).toMatch(/\.env\("MBLZ_UPDATER_PUBLIC_KEY", include_str!\("\.\.\/updater\.pub"\)\.trim\(\)\)/);
  });
});

describe("no private signing material in the repository", () => {
  const MARKERS = [["untrusted comment: rsign encrypted ", "secret key"], ["-----BEGIN ", "PRIVATE KEY-----"], ["-----BEGIN ", "ENCRYPTED PRIVATE KEY-----"]].map(p => p.join(""));
  const b64 = (s: string) => Buffer.from(s).toString("base64").slice(0, 30);
  it("no tracked or staged-for-tracking file contains a private key header (plain or base64)", () => {
    const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\0").filter(Boolean);
    const hits: string[] = [];
    for (const f of files) {
      if (!fs.existsSync(f) || fs.statSync(f).size > 5_000_000) continue;
      const text = fs.readFileSync(f).toString("latin1");
      if (MARKERS.some(m => text.includes(m) || text.includes(b64(m)))) hits.push(f);
    }
    expect(hits).toEqual([]);
  });
  it("git ignores key files, certificates and password files", () => {
    for (const f of ["x.key", "cert.p12", "cert.pfx", "k.pem", "secrets/anything", "updater-key-password.txt"]) {
      const r = spawnSync("git", ["check-ignore", "-q", f]); expect(r.status, f).toBe(0);
    }
  });
});
