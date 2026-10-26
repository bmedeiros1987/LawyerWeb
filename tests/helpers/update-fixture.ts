// Synthetic release/manifest builders for updater tests. No network, no real package, no real key.
import crypto from "node:crypto";
import { packageUrlFor, MANIFEST_ASSET, type UpdateManifest, type UpdateTarget } from "@/lib/desktop/update-manifest";
import { syntheticSigner } from "./minisign-fixture";

export const sha256 = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");
export const TAG = "v2.0.0";
export const NAMES: Record<UpdateTarget, string> = {
  "windows-x86_64": "LawyerMind_2.0.0_x64-setup.exe",
  "darwin-aarch64": "LawyerMind_2.0.0_aarch64.dmg",
  "darwin-x86_64": "LawyerMind_2.0.0_x64.dmg",
  "linux-x86_64": "LawyerMind_2.0.0_amd64.deb",
};
export const bytesFor = (target: UpdateTarget) => Buffer.from(`pacote sintético ${target}`);

export function manifestFor(targets: UpdateTarget[], over: Partial<UpdateManifest> = {}): UpdateManifest {
  const signer = syntheticSigner();
  return {
    schema: "mblz-update-manifest-v1", version: "2.0.0", notes: "Correções sintéticas <b>em texto</b>.", pubDate: "2026-10-24T12:00:00Z", minimumInstalledVersion: "1.0.0",
    platforms: Object.fromEntries(targets.map(t => [t, { name: NAMES[t], url: packageUrlFor(TAG, NAMES[t]), size: bytesFor(t).length, sha256: sha256(bytesFor(t)), signature: signer.sign(bytesFor(t)).tauri }])) as UpdateManifest["platforms"],
    ...over,
  };
}

export function releaseFor(targets: UpdateTarget[], over: Record<string, unknown> = {}) {
  return {
    tag_name: TAG, draft: false, prerelease: false, body: "", html_url: `https://github.com/bmedeiros1987/LawyerWeb/releases/tag/${TAG}`,
    assets: [
      { name: MANIFEST_ASSET, size: 1, browser_download_url: packageUrlFor(TAG, MANIFEST_ASSET) },
      ...targets.map(t => ({ name: NAMES[t], size: bytesFor(t).length, browser_download_url: packageUrlFor(TAG, NAMES[t]) })),
    ],
    ...over,
  };
}

/** Routes the release list and the manifest download to synthetic answers. Records every URL requested. */
export function releaseFetcher(releases: unknown[], manifest: unknown | (() => Response)) {
  const urls: string[] = [];
  const fetcher = (async (url: string) => {
    urls.push(url);
    if (url.includes("api.github.com")) return Response.json(releases);
    if (url.endsWith(MANIFEST_ASSET)) return typeof manifest === "function" ? (manifest as () => Response)() : Response.json(manifest);
    throw new Error("URL inesperada " + url);
  }) as typeof fetch;
  return { fetcher, urls };
}
