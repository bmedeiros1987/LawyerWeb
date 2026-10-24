// Public release check: read-only, bounded. The fetcher is substituted; nothing reaches GitHub.
// "update-available" requires a validated manifest (version, link, changelog, SHA-256, signature,
// upgrade path) for this exact platform AND architecture.
import { describe, expect, it } from "vitest";
import { createReleaseChecker, safeReleaseUrl, semver } from "@/lib/desktop/release-check";
import { MANIFEST_ASSET, type UpdateTarget } from "@/lib/desktop/update-manifest";
import { releaseFetcher, releaseFor, manifestFor, NAMES } from "./helpers/update-fixture";

const ALL: UpdateTarget[] = ["windows-x86_64", "darwin-aarch64", "darwin-x86_64", "linux-x86_64"];
const check = (fetcher: typeof fetch, platform = "darwin", installedVersion = "1.0.0", arch = "arm64") => createReleaseChecker({ installedVersion, platform, arch, fetcher }).check();
const full = (targets = ALL, over = {}) => releaseFetcher([releaseFor(targets, over)], manifestFor(targets)).fetcher;

describe("release check", () => {
  it.each([
    ["no stable release", async () => Response.json([]), "no-release"],
    ["offline", async () => { throw new TypeError("fetch failed"); }, "offline"],
    ["rate limited", async () => new Response("", { status: 429 }), "rate-limited"],
    ["malformed", async () => Response.json({}), "error"],
    ["drafts and prereleases ignored", async () => Response.json([{ ...releaseFor(ALL), draft: true }, { ...releaseFor(ALL), prerelease: true }]), "no-release"],
  ])("%s", async (_name, fetcher, status) => {
    const r = await check(fetcher as typeof fetch);
    expect(r.status).toBe(status);
    if (status === "offline") expect(r.message).toMatch(/não confirma/);
  });

  it("older release is current", async () => {
    expect((await check(releaseFetcher([releaseFor(ALL, { tag_name: "v0.9.0" })], {}).fetcher)).status).toBe("current");
  });

  it("offers an update only with a complete, consistent manifest", async () => {
    const r = await check(full());
    expect(r.status).toBe("update-available");
    expect(r.target).toBe("darwin-aarch64");
    expect(r.package).toMatchObject({ name: NAMES["darwin-aarch64"], target: "darwin-aarch64" });
    expect(r.notes).toBe("Correções sintéticas <b>em texto</b>."); // shown as text, never HTML
    expect(r.message).toMatch(/só são conferidos ao baixar/);
  });

  it("separates Apple Silicon from Intel and never crosses packages", async () => {
    const arm = await check(full(), "darwin", "1.0.0", "arm64"), intel = await check(full(), "darwin", "1.0.0", "x64");
    expect(arm.package?.name).toBe(NAMES["darwin-aarch64"]);
    expect(intel.package?.name).toBe(NAMES["darwin-x86_64"]);
    // A release that only carries the Apple Silicon build is unavailable (not "update") for an Intel Mac.
    const onlyArm = full(["darwin-aarch64"]);
    expect((await check(onlyArm, "darwin", "1.0.0", "x64")).status).toBe("platform-unavailable");
    expect((await check(onlyArm, "darwin", "1.0.0", "arm64")).status).toBe("update-available");
  });

  it("matches each platform and reports unsupported architectures", async () => {
    expect((await check(full(), "win32", "1.0.0", "x64")).package?.name).toBe(NAMES["windows-x86_64"]);
    expect((await check(full(), "linux", "1.0.0", "x64")).package?.name).toBe(NAMES["linux-x86_64"]);
    expect((await check(full(), "win32", "1.0.0", "arm64")).status).toBe("platform-unavailable");
    expect((await check(full(), "freebsd", "1.0.0", "x64")).status).toBe("platform-unavailable");
  });

  it("a newer release without a manifest is not an update", async () => {
    const r = await check(releaseFetcher([{ ...releaseFor([]), assets: [{ name: NAMES["darwin-aarch64"], size: 1 }] }], {}).fetcher);
    expect(r.status).toBe("release-unverified");
    expect(r.package).toBeUndefined();
  });

  it.each([
    ["wrong schema", (m: object) => ({ ...m, schema: "x" })],
    ["version differs from tag", (m: object) => ({ ...m, version: "2.0.1" })],
    ["package link outside the release", (m: any) => ({ ...m, platforms: { ...m.platforms, "darwin-aarch64": { ...m.platforms["darwin-aarch64"], url: "https://evil.test/a.dmg" } } })],
    ["missing signature", (m: any) => ({ ...m, platforms: { ...m.platforms, "darwin-aarch64": { ...m.platforms["darwin-aarch64"], signature: "" } } })],
    ["bad sha256", (m: any) => ({ ...m, platforms: { ...m.platforms, "darwin-aarch64": { ...m.platforms["darwin-aarch64"], sha256: "abc" } } })],
    ["Intel package listed for Apple Silicon", (m: any) => ({ ...m, platforms: { ...m.platforms, "darwin-aarch64": { ...m.platforms["darwin-aarch64"], name: NAMES["darwin-x86_64"], url: m.platforms["darwin-x86_64"].url } } })],
    ["unknown field", (m: object) => ({ ...m, extra: true })],
  ])("rejects a manifest with %s", async (_name, mutate) => {
    const targets: UpdateTarget[] = ["darwin-aarch64", "darwin-x86_64"];
    const r = await check(releaseFetcher([releaseFor(targets)], mutate(manifestFor(targets))).fetcher);
    expect(r.status).toBe("release-unverified");
    expect(r.package).toBeUndefined();
  });

  it("requires the published asset to match manifest size, and a changelog", async () => {
    const targets: UpdateTarget[] = ["darwin-aarch64"];
    const wrongSize = releaseFor(targets); (wrongSize.assets[1] as { size: number }).size += 1;
    expect((await check(releaseFetcher([wrongSize], manifestFor(targets)).fetcher)).status).toBe("release-unverified");
    expect((await check(releaseFetcher([releaseFor(targets)], manifestFor(targets, { notes: "  " })).fetcher)).status).toBe("release-unverified");
    // The release body counts as the changelog when the manifest has none.
    expect((await check(releaseFetcher([releaseFor(targets, { body: "Notas da release" })], manifestFor(targets, { notes: "" })).fetcher)).status).toBe("update-available");
  });

  it("blocks an upgrade path the manifest does not support", async () => {
    const targets: UpdateTarget[] = ["darwin-aarch64"];
    const r = await check(releaseFetcher([releaseFor(targets)], manifestFor(targets, { minimumInstalledVersion: "1.5.0" })).fetcher);
    expect(r.status).toBe("incompatible");
    expect(r.message).toMatch(/1\.5\.0/);
  });

  it("unknown installed version is never called current", async () => {
    expect((await check(full(), "darwin", "dev")).status).toBe("unknown-installed");
  });

  it("single flight and cooldown", async () => {
    let calls = 0;
    const c = createReleaseChecker({ installedVersion: "1.0.0", platform: "linux", arch: "x64", fetcher: (async () => { calls++; return Response.json([]); }) as typeof fetch });
    await Promise.all([c.check(), c.check()]);
    expect((await c.check()).cached).toBe(true);
    expect(calls).toBe(1);
  });

  it("refuses oversized answers, oversized manifests and foreign links", async () => {
    const big = new Response("[" + " ".repeat(300_000) + "]", { headers: { "content-length": "300002" } });
    expect((await check(async () => big)).status).toBe("error");
    const hugeManifest = releaseFetcher([releaseFor(["darwin-aarch64"])], () => new Response("{" + " ".repeat(70_000) + "}", { headers: { "content-length": "70002" } }));
    expect((await check(hugeManifest.fetcher)).status).toBe("release-unverified");
    expect((await check(async () => Response.json([{ ...releaseFor(ALL), html_url: "https://evil.test/releases/tag/v2.0.0" }]))).status).toBe("error");
    const badAsset = releaseFor(["darwin-aarch64"]); (badAsset.assets[0] as { browser_download_url: string }).browser_download_url = "https://evil.test/" + MANIFEST_ASSET;
    expect((await check(releaseFetcher([badAsset], manifestFor(["darwin-aarch64"])).fetcher)).status).toBe("error");
    expect(safeReleaseUrl("https://github.com/bmedeiros1987/LawyerWeb/releases/tag/v1?x=1")).toBeNull();
    expect(semver("v1.2.3")).toEqual([1, 2, 3]);
    expect(semver("1.2")).toBeNull();
  });
});
