"use client";
// Native file dialogs are provided by the desktop shell (Tauri IPC). They only
// return a path chosen by the user; reading/writing happens on the local server.
type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
const invoke = (): Invoke | null => (typeof window !== "undefined" && (window as unknown as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke) || null;

async function call(cmd: string, args: Record<string, unknown>, fallback: string): Promise<string | null> {
  const i = invoke();
  if (i) return (await i(cmd, args)) as string | null;
  const typed = window.prompt(fallback);
  return typed?.trim() || null;
}

export const pickFile = (title: string, backup = false) => call("pick_file", { title, backupOnly: backup }, `${title}: caminho completo do arquivo`);
export const pickFolder = (title: string) => call("pick_folder", { title }, `${title}: caminho completo da pasta`);
export const pickSave = (title: string, defaultName: string, backup = false) => call("pick_save", { title, defaultName, backupOnly: backup }, `${title}: caminho completo do novo arquivo`);

export async function postJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data?.error ?? "Não foi possível concluir a operação."), { status: r.status, code: data?.code });
  return data as T;
}
