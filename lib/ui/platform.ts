// Keyboard shortcuts per platform: ⌘ on macOS, Ctrl on Windows and Linux.
// The label shown, the tooltip and the key actually handled come from here.
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const p = nav.userAgentData?.platform || nav.platform || nav.userAgent;
  return /mac|iphone|ipad|ipod/i.test(p);
}

/** True for the platform's primary modifier only (⌘ on Mac, Ctrl elsewhere), never both. */
export function primaryModifier(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }, mac = isMacPlatform()): boolean {
  return !e.altKey && (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
}

export function shortcutLabel(key: string, mac = isMacPlatform()): string {
  return mac ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`;
}

type Invoke = (cmd: string) => Promise<unknown>;
let native: Promise<string | null> | undefined;
/** The desktop shell reports the real OS (Tauri `desktop_platform`); on the web this is null. */
export function nativePlatform(): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const invoke = (window as unknown as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke;
  if (!invoke) return Promise.resolve(null);
  return native ??= invoke("desktop_platform").then(p => (p === "macos" || p === "windows" || p === "linux" ? p : null), () => null);
}

/** Mac or not: the desktop shell decides when present, otherwise the browser's report. */
export async function detectMac(): Promise<boolean> {
  const p = await nativePlatform();
  return p ? p === "macos" : isMacPlatform();
}
