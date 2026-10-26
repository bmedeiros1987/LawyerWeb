// Rehearsal of the app's OWN verified-download path on REAL installers (tens or hundreds of MB), signed with the real
// `tauri signer`. Skipped unless LM_REHEARSAL_DIR points to a folder with the installers, their .sig files and
// `rehearsal.pub`. Use a THROWAWAY key here, never the production key on builds that are not signed by the OS.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { downloadVerifiedPackage } from "@/lib/desktop/update-download";
import type { UpdatePackage } from "@/lib/desktop/update-manifest";

const DIR = process.env.LM_REHEARSAL_DIR;
const files = DIR ? fs.readdirSync(DIR).filter(f => /\.(exe|dmg)$/i.test(f)) : [];

describe.skipIf(!DIR)("real installers through downloadVerifiedPackage", () => {
  for (const name of files) {
    it(`${name}: streams, hashes and verifies the signature; refuses a flipped byte`, async () => {
      const file = path.join(DIR!, name), size = fs.statSync(file).size, pub = fs.readFileSync(path.join(DIR!, "rehearsal.pub"), "utf8").trim();
      const sig = fs.readFileSync(file + ".sig", "utf8").trim();
      const sha = await new Promise<string>((res, rej) => { const h = crypto.createHash("sha256"); fs.createReadStream(file).on("data", d => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej); });
      const target = name.endsWith(".exe") ? "windows-x86_64" : "darwin-aarch64";
      const pkg: UpdatePackage = { target, name, url: `https://github.com/bmedeiros1987/LawyerWeb/releases/download/v0.1.0/${name}`, size, sha256: sha, signature: sig };
      const serve = (flip = false) => (async () => {
        const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream<Uint8Array>;
        if (!flip) return new Response(stream, { headers: { "content-length": String(size) } });
        let first = true;
        return new Response(stream.pipeThrough(new TransformStream({ transform(chunk, c) { if (first) { chunk = chunk.slice(); chunk[0] ^= 1; first = false; } c.enqueue(chunk); } })), { headers: { "content-length": String(size) } });
      }) as typeof fetch;
      const staging = fs.mkdtempSync(path.join(os.tmpdir(), "lm-rehearsal-"));
      try {
        const rss0 = process.memoryUsage().rss, t0 = Date.now();
        const ok = await downloadVerifiedPackage({ pkg, tag: "v0.1.0", publicKey: pub, stagingRoot: staging, fetcher: serve() });
        const ms = Date.now() - t0, grewMiB = Math.round((process.memoryUsage().rss - rss0) / 1048576);
        console.log(`[rehearsal] ${name}: ${(size / 1048576).toFixed(1)} MiB verified in ${ms} ms; rss grew ${grewMiB} MiB`);
        expect(ok).toMatchObject({ signatureVerified: true, sha256: sha, size });
        expect(fs.statSync(ok.path).size).toBe(size);
        expect(grewMiB).toBeLessThan(250); // streamed: far below the installer size
        // One flipped byte: the SHA-256 check refuses it and nothing is left behind.
        const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "lm-rehearsal-")); 
        try {
          await expect(downloadVerifiedPackage({ pkg, tag: "v0.1.0", publicKey: pub, stagingRoot: dir2, fetcher: serve(true) })).rejects.toMatchObject({ code: "checksum" });
          const left = fs.existsSync(path.join(dir2, "v-v0.1.0")) ? fs.readdirSync(path.join(dir2, "v-v0.1.0")) : [];
          expect(left).toEqual([]);
        } finally { fs.rmSync(dir2, { recursive: true, force: true }); }
      } finally { fs.rmSync(staging, { recursive: true, force: true }); }
    }, 300_000);
  }
});
