import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppsInfo, openSystemSettings } from "@/lib/desktop/default-apps";

afterEach(() => vi.unstubAllEnvs());
const fakeSpawn = () => { const child = { on: vi.fn(), unref: vi.fn() }; const run = vi.fn(() => child); return { run: run as never, calls: run, child }; };

describe("default app guidance", () => {
  it("windows: points at the system Default apps page and never edits a default itself", () => {
    const i = defaultAppsInfo("win32");
    expect(i).toMatchObject({ platform: "windows", canOpenSystemSettings: true });
    expect(i.steps.join(" ")).toMatch(/Aplicativos padrão/);
    const s = fakeSpawn();
    expect(openSystemSettings("win32", s.run)).toBe(true);
    expect(s.calls).toHaveBeenCalledTimes(1);
    expect(s.calls).toHaveBeenCalledWith("explorer.exe", ["ms-settings:defaultapps"], expect.objectContaining({ shell: false }));
  });
  it("macos: Apple's Finder flow only; nothing is launched or changed", () => {
    const i = defaultAppsInfo("darwin");
    expect(i).toMatchObject({ platform: "macos", canOpenSystemSettings: false });
    expect(i.steps.join(" ")).toMatch(/Obter Informações/); expect(i.steps.join(" ")).toMatch(/Alterar Tudo/);
    const s = fakeSpawn();
    expect(openSystemSettings("darwin", s.run)).toBe(false); expect(openSystemSettings("linux", s.run)).toBe(false);
    expect(s.calls).not.toHaveBeenCalled();
  });
  it("the packaged self-test never launches anything", () => {
    vi.stubEnv("MBLZ_DESKTOP_NO_LAUNCH", "1");
    const s = fakeSpawn();
    expect(openSystemSettings("win32", s.run)).toBe(false); expect(s.calls).not.toHaveBeenCalled();
  });
  it("legacy .doc is explicitly left out of the association", () => {
    for (const p of ["win32", "darwin", "linux"] as const) expect(defaultAppsInfo(p).legacyDocNote).toMatch(/\.doc.*não são associados/);
  });
});
