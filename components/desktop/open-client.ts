"use client";
// Files the operating system asked LawyerMind to open. The shell queues them (lexically filtered) and hands
// them over once; they are kept here, in this window's sessionStorage only, until the user imports or dismisses them.
type Tauri = { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }; event?: { listen?: (name: string, cb: () => void) => Promise<() => void> } };
const tauri = (): Tauri | undefined => (typeof window === "undefined" ? undefined : (window as unknown as { __TAURI__?: Tauri }).__TAURI__);
const KEY = "lawyermind.pending-open-files";
export const MAX_PENDING = 16;
export const REVIEW_PATH = "/app/documentos/abrir";

export function storedOpens(): string[] {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_PENDING) : []; } catch { return []; }
}
function save(list: string[]) { try { sessionStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_PENDING))); } catch { /* storage unavailable */ } }
export function forgetOpen(path: string) { save(storedOpens().filter(p => p !== path)); }

/** Takes what the shell has queued and merges it with what this window already holds. */
export async function drainPendingOpens(): Promise<string[]> {
  let fresh: string[] = [];
  const invoke = tauri()?.core?.invoke;
  if (invoke) { try { const r = await invoke("take_pending_opens"); if (Array.isArray(r)) fresh = r.filter((x): x is string => typeof x === "string"); } catch { /* shell without the command */ } }
  const merged = [...new Set([...storedOpens(), ...fresh])].slice(0, MAX_PENDING);
  save(merged);
  return merged;
}

export function listenForOpens(onOpen: () => void): () => void {
  const listen = tauri()?.event?.listen;
  if (!listen) return () => {};
  let off: (() => void) | undefined, cancelled = false;
  listen("lawyermind-open-files", onOpen).then(u => { if (cancelled) u(); else off = u; }).catch(() => {});
  return () => { cancelled = true; off?.(); };
}
