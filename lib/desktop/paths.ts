// Working copies are addressed by a storage key relative to the documents
// root, always with '/' separators, so the folder can be relocated or restored
// elsewhere. Keys can never escape the root: lexically (no '..', absolute
// paths, drive letters) and physically (no symbolic link, junction or hard
// link below the root, checked component by component on disk).
import fs from "node:fs";
import path from "node:path";
import { DesktopError } from "./env";

export function resolveStorageKey(root: string, key: string): string {
  if (!key || key.startsWith("/") || key.includes("\\") || key.includes(":") || key.includes("\0")) throw new DesktopError(`Caminho de documento inválido: ${key}`, 422);
  const parts = key.split("/");
  if (parts.some(p => !p || p === "." || p === "..")) throw new DesktopError(`Caminho de documento inválido: ${key}`, 422);
  return path.join(path.resolve(root), ...parts);
}

const code = (e: unknown) => (e as NodeJS.ErrnoException).code;

/** Real path of an existing folder (the folder itself may be reached through a link chosen by the user). */
export function realDir(dir: string): string {
  let st: fs.Stats;
  try { st = fs.statSync(dir); } catch { throw new DesktopError(`Pasta não encontrada: ${dir}`, 404, "missing-root"); }
  if (!st.isDirectory()) throw new DesktopError(`Não é uma pasta: ${dir}`, 400);
  return fs.realpathSync.native(dir);
}

/** True when `p` is `dir` or inside it (both absolute, compared case-insensitively on Windows/macOS). */
export function isInside(dir: string, p: string): boolean {
  const norm = (x: string) => { const r = path.resolve(x); return process.platform === "linux" ? r : r.toLowerCase(); };
  const rel = path.relative(norm(dir), norm(p));
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Real path of `p`, resolving its deepest existing ancestor (for paths that do not exist yet). */
export function realPathLoose(p: string): string {
  let cur = path.resolve(p); const rest: string[] = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...rest.reverse()); }
    catch (e) {
      if (code(e) !== "ENOENT" && code(e) !== "ENOTDIR") throw e;
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur)); cur = parent;
    }
  }
}

const linkError = (key: string) => new DesktopError(`Link simbólico, junção ou atalho não é permitido na pasta de documentos (${key}). Nada foi lido nem gravado.`, 422, "link");

/**
 * Absolute path of `key` under `root` that cannot leave the root: every
 * existing component below the root is checked with lstat and must not be a
 * symbolic link or junction (Windows junctions are reported as links);
 * intermediate components must be folders; an existing final component must
 * be a regular file with a single hard link. `expect: "file"` also requires it
 * to exist; `"absent"` requires that it does not.
 */
export function containedPath(root: string, key: string, expect: "file" | "absent" | "any" = "any"): string {
  resolveStorageKey(root, key);
  const base = realDir(root);
  const parts = key.split("/");
  let cur = base;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    let st: fs.Stats;
    try { st = fs.lstatSync(cur); }
    catch (e) {
      if (code(e) !== "ENOENT") throw e;
      if (expect === "file") throw new DesktopError(`Arquivo não encontrado: ${key}`, 404, "missing");
      return path.join(base, ...parts);
    }
    const shown = parts.slice(0, i + 1).join("/");
    if (st.isSymbolicLink()) throw linkError(shown);
    const last = i === parts.length - 1;
    if (!last && !st.isDirectory()) throw new DesktopError(`Caminho de documento inválido: ${shown}`, 422);
    if (last) {
      if (expect === "absent") throw new DesktopError(`Já existe um arquivo em ${key}.`, 409, "exists");
      if (!st.isFile()) throw new DesktopError(`Não é um arquivo comum: ${key}`, 422, "link");
      if (st.nlink > 1) throw new DesktopError(`O arquivo ${key} tem outro vínculo (hard link) fora da pasta de documentos. Nada foi lido nem gravado.`, 422, "link");
    }
  }
  // Defense in depth: whatever exists must physically resolve inside the root.
  if (!isInside(base, realPathLoose(cur))) throw linkError(key);
  return cur;
}

/** Creates the folders of `dirKey` under `root` one by one, refusing links. Returns the real path. */
export function ensureContainedDir(root: string, dirKey: string): string {
  const base = realDir(root);
  let cur = base;
  resolveStorageKey(base, dirKey);
  for (const [i, part] of dirKey.split("/").entries()) {
    cur = path.join(cur, part);
    try { fs.mkdirSync(cur); } catch (e) { if (code(e) !== "EEXIST") throw e; }
    const st = fs.lstatSync(cur);
    if (st.isSymbolicLink()) throw linkError(dirKey.split("/").slice(0, i + 1).join("/"));
    if (!st.isDirectory()) throw new DesktopError(`Caminho de documento inválido: ${dirKey}`, 422);
  }
  if (!isInside(base, fs.realpathSync.native(cur))) throw linkError(dirKey);
  return cur;
}

/** Opens a contained file for reading and checks the handle is the same file that was validated. */
export function openContained(root: string, key: string): { fd: number; path: string; stat: fs.Stats } {
  const file = containedPath(root, key, "file");
  const before = fs.lstatSync(file);
  const fd = fs.openSync(file, "r");
  const st = fs.fstatSync(fd);
  if (st.ino !== before.ino || st.dev !== before.dev || !st.isFile() || st.nlink > 1) { fs.closeSync(fd); throw linkError(key); }
  return { fd, path: file, stat: st };
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

/** Flushes a file's bytes to disk. */
export function fsyncFile(file: string) {
  const fd = fs.openSync(file, "r+");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/** Flushes a folder entry (a rename) to disk. Windows cannot open folders for this; NTFS journals the rename. */
export function fsyncDir(dir: string) {
  if (process.platform === "win32") return;
  const fd = fs.openSync(dir, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
