"use client";
// Opens a document screen in a SEPARATE window (second monitor). In the desktop app this asks the shell, which
// only accepts a short allow-list of local screens; elsewhere it falls back to a normal new tab. The current
// window is never navigated, so nothing in it is lost.
type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
const invoke = (): Invoke | undefined => (typeof window === "undefined" ? undefined : (window as unknown as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke);

export async function openInNewWindow(path: string): Promise<"window" | "tab"> {
  const call = invoke();
  if (call) { await call("open_document_window", { path }); return "window"; }
  window.open(path, "_blank", "noopener");
  return "tab";
}

export const comparePath = (left: string, right: string, pane: "ambos" | "esq" | "dir" = "ambos") =>
  `/app/documentos/comparar?esq=${encodeURIComponent(left)}&dir=${encodeURIComponent(right)}&painel=${pane}`;
