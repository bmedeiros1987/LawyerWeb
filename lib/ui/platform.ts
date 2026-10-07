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
