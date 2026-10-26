// Synthetic only: bytes, signatures and fetcher are fabricated; nothing is downloaded or installed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { downloadVerifiedPackage } from "@/lib/desktop/update-download";
import { packageFor, type UpdatePackage } from "@/lib/desktop/update-manifest";
import { syntheticSigner } from "./helpers/minisign-fixture";
import { TAG, bytesFor, manifestFor, sha256 } from "./helpers/update-fixture";

let staging: string;
beforeEach(() => { staging = fs.mkdtempSync(path.join(os.tmpdir(), "lm-upd-")); });
afterEach(() => { fs.rmSync(staging, { recursive: true, force: true }); });

const signer = syntheticSigner();
const pkg = (): UpdatePackage => packageFor(manifestFor(["darwin-aarch64"]), "darwin-aarch64")!;
const serve = (body: Uint8Array, init: { url?: string; status?: number; length?: number | null } = {}) => (async () => {
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(body.subarray(0, 5)); c.enqueue(body.subarray(5)); c.close(); } });
  const headers: Record<string, string> = init.length === null ? {} : { "content-length": String(init.length ?? body.length) };
  const response = new Response(stream, { status: init.status ?? 200, headers });
  if (init.url) Object.defineProperty(response, "url", { value: init.url });
  return response;
}) as unknown as typeof fetch;
const run = (over: Partial<Parameters<typeof downloadVerifiedPackage>[0]> = {}) =>
  downloadVerifiedPackage({ pkg: pkg(), tag: TAG, publicKey: signer.publicKeyTauri, stagingRoot: staging, fetcher: serve(bytesFor("darwin-aarch64")), now: () => 0, ...over });
const leftovers = () => fs.readdirSync(path.join(staging, `v-${TAG}`));

describe("verified package download", () => {
  it("saves a new, verified copy and a record, without executing anything", async () => {
    const result = await run({ fetcher: serve(bytesFor("darwin-aarch64"), { url: "https://release-assets.githubusercontent.com/x" }) });
    expect(result).toMatchObject({ signatureVerified: true, sha256: sha256(bytesFor("darwin-aarch64")), size: bytesFor("darwin-aarch64").length });
    expect(fs.readFileSync(result.path)).toEqual(bytesFor("darwin-aarch64"));
    expect(fs.statSync(result.path).mode & 0o111).toBe(0); // not executable
    expect(leftovers().sort()).toEqual(["LawyerMind_2.0.0_aarch64.dmg", "LawyerMind_2.0.0_aarch64.dmg.verified.json"]);
    expect(JSON.parse(fs.readFileSync(`${result.path}.verified.json`, "utf8")).verifiedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("works with a legacy (non-prehashed) signature", async () => {
    const p = { ...pkg(), signature: signer.sign(bytesFor("darwin-aarch64"), { prehashed: false }).tauri };
    expect((await run({ pkg: p })).signatureVerified).toBe(true);
  });

  it("without a configured public key nothing is fetched", async () => {
    let calls = 0;
    await expect(run({ publicKey: undefined, fetcher: (async () => { calls++; return new Response(""); }) as typeof fetch })).rejects.toMatchObject({ status: 503, code: "updater-not-configured" });
    expect(calls).toBe(0);
  });

  it.each([
    ["checksum mismatch", { body: Buffer.from("pacote sintético XXXXXXXXXXXXXX") }, "checksum"],
    ["signature by another key", { pkg: { ...pkg(), signature: syntheticSigner("other").sign(bytesFor("darwin-aarch64")).tauri } }, "signature-key"],
    ["signature does not cover these bytes", { body: Buffer.from("x".repeat(bytesFor("darwin-aarch64").length)), sha: true }, "signature"],
    ["malformed signature", { pkg: { ...pkg(), signature: "nao-e-assinatura" } }, "signature-format"],
    ["announced size differs", { length: 7 }, "size"],
    ["stream longer than declared", { body: Buffer.concat([bytesFor("darwin-aarch64"), Buffer.from("extra")]), length: null }, "size"],
    ["stream shorter than declared", { body: bytesFor("darwin-aarch64").subarray(0, 12), length: null }, "size"],
    ["HTTP error", { status: 404 }, "http"],
    ["unexpected host", { url: "https://evil.test/pkg" }, "unexpected-host"],
  ])("rejects: %s, discarding the file", async (_name, c: any, code) => {
    let p: UpdatePackage = c.pkg ?? pkg();
    if (c.sha) p = { ...p, sha256: sha256(c.body) }; // checksum matches the tampered bytes; only the signature can catch it
    await expect(run({ pkg: p, fetcher: serve(c.body ?? bytesFor("darwin-aarch64"), c) })).rejects.toMatchObject({ code });
    const dir = path.join(staging, `v-${TAG}`);
    expect(fs.existsSync(dir) ? leftovers() : []).toEqual([]);
  });

  it("never overwrites an existing package", async () => {
    await run();
    await expect(run()).rejects.toMatchObject({ code: "exists" });
    expect(fs.readFileSync(path.join(staging, `v-${TAG}`, "LawyerMind_2.0.0_aarch64.dmg"))).toEqual(bytesFor("darwin-aarch64"));
  });
});
