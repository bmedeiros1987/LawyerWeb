// Working copies are addressed by a storage key relative to the documents
// root, always with '/' separators, so the folder can be relocated or restored
// elsewhere. Keys can never escape the root.
import path from "node:path";
import { DesktopError } from "./env";

export function resolveStorageKey(root: string, key: string): string {
  if (!key || key.startsWith("/") || key.includes("\\") || key.includes(":") || key.includes("\0")) throw new DesktopError(`Caminho de documento inválido: ${key}`, 422);
  const parts = key.split("/");
  if (parts.some(p => !p || p === "." || p === "..")) throw new DesktopError(`Caminho de documento inválido: ${key}`, 422);
  return path.join(path.resolve(root), ...parts);
}

/** A file or folder name valid on Windows, macOS and Linux. */
export function safeName(raw: string, max = 80): string {
  let s = [...raw].map(c => /[<>:"/\\|?*\u0000-\u001f]/.test(c) ? "_" : c).join("").trim().replace(/^[.\s]+|[.\s]+$/g, "");
  if ([...s].length > max) {
    const ext = path.extname(s).slice(0, 12);
    s = [...s.slice(0, s.length - ext.length)].slice(0, max - ext.length).join("").trim() + ext;
  }
  if (!s) s = "documento";
  const stem = s.split(".")[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/.test(stem)) s = "_" + s;
  return s;
}
