// Public release check (from the dot settings patch): read-only, bounded, no
// installer. The fetcher is substituted; nothing reaches GitHub.
import { describe, expect, it } from "vitest";
import { createReleaseChecker, safeReleaseUrl, semver } from "@/lib/desktop/release-check";

const release = { tag_name: "v2.0.0", draft: false, prerelease: false, assets: [{ name: "LawyerMind_2.0.0_aarch64.dmg" }], html_url: "https://github.com/bmedeiros1987/LawyerWeb/releases/tag/v2.0.0", body: "<script>texto</script>" };
const check = (fetcher: typeof fetch, platform = "darwin", installedVersion = "1.0.0") => createReleaseChecker({ installedVersion, platform, fetcher }).check();

describe("release check", () => {
  it.each([
    ["no stable release", async () => Response.json([]), "no-release"],
    ["offline", async () => { throw new TypeError("fetch failed"); }, "offline"],
    ["rate limited", async () => new Response("", { status: 429 }), "rate-limited"],
    ["malformed", async () => Response.json({}), "error"],
    ["older release", async () => Response.json([{ ...release, tag_name: "v0.9.0" }]), "current"],
    ["no package for this OS", async () => Response.json([{ ...release, assets: [] }]), "platform-unavailable"],
    ["newer release", async () => Response.json([release]), "update-available"],
    ["drafts and prereleases ignored", async () => Response.json([{ ...release, draft: true }, { ...release, prerelease: true }]), "no-release"],
  ])("%s", async (_name, fetcher, status) => {
    const r = await check(fetcher as typeof fetch);
    expect(r.status).toBe(status);
    if (status === "offline") expect(r.message).toMatch(/não confirma/);
    if (status === "update-available") expect(r.notes).toBe("<script>texto</script>"); // shown as text, never HTML
  });

  it("matches the installer of each platform", async () => {
    const assets = [{ name: "a.dmg" }, { name: "a-setup.exe" }, { name: "a.deb" }];
    for (const platform of ["darwin", "win32", "linux"]) expect((await check(async () => Response.json([{ ...release, assets: [assets.shift()] }]), platform)).status).toBe("update-available");
  });

  it("unknown installed version is never called current", async () => {
    expect((await check(async () => Response.json([release]), "darwin", "dev")).status).toBe("unknown-installed");
  });

  it("single flight and cooldown", async () => {
    let calls = 0;
    const c = createReleaseChecker({ installedVersion: "1.0.0", platform: "linux", fetcher: (async () => { calls++; return Response.json([]); }) as typeof fetch });
    await Promise.all([c.check(), c.check()]);
    expect((await c.check()).cached).toBe(true);
    expect(calls).toBe(1);
  });

  it("refuses oversized answers and foreign links", async () => {
    const big = new Response("[" + " ".repeat(300_000) + "]", { headers: { "content-length": "300002" } });
    expect((await check(async () => big)).status).toBe("error");
    expect((await check(async () => Response.json([{ ...release, html_url: "https://evil.test/releases/tag/v2.0.0" }]))).status).toBe("error");
    expect(safeReleaseUrl("https://github.com/bmedeiros1987/LawyerWeb/releases/tag/v1?x=1")).toBeNull();
    expect(semver("v1.2.3")).toEqual([1, 2, 3]);
    expect(semver("1.2")).toBeNull();
  });
});
