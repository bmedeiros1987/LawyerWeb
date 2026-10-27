// Bundled editors (derived from the MIT/Apache PdfCraft and WordCraft, see docs/EDITORS.md).
// They are separate programs, started only on a WORKING COPY (never the original), without a
// shell, with a minimal environment. Not present in a build => the feature is reported as
// unavailable, never faked.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type EditorKind = "pdf" | "word";

const BINARY: Record<EditorKind, string> = { pdf: "lawyermind-pdf", word: "lawyermind-word" };
const EXT: Record<EditorKind, RegExp> = { pdf: /\.pdf$/i, word: /\.docx$/i };

export const editorKindFor = (fileName: string): EditorKind | null => (EXT.pdf.test(fileName) ? "pdf" : EXT.word.test(fileName) ? "word" : null);

/** Absolute path of the bundled editor, or null when this build does not ship it. */
export function editorBinary(kind: EditorKind, dir = process.env.MBLZ_EDITORS_DIR): string | null {
  if (!dir || !path.isAbsolute(dir)) return null;
  const file = path.join(dir, BINARY[kind] + (process.platform === "win32" ? ".exe" : ""));
  try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
}

export const editorAvailability = (dir = process.env.MBLZ_EDITORS_DIR) => ({ pdf: editorBinary("pdf", dir) !== null, word: editorBinary("word", dir) !== null });

/** Environment handed to the editor: only what a GUI program needs to start; no tokens or app variables. */
export function editorEnv(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const keep = ["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "LANG", "LC_ALL"];
  const env: Record<string, string> = {};
  for (const k of keep) { const v = source[k]; if (v !== undefined) env[k] = v; }
  env.LAWYERMIND_EDITOR = "1";
  return env;
}

/** Starts the editor on `file`; resolves to false when this build has no such editor. */
export function openWithEditor(kind: EditorKind, file: string): boolean {
  const bin = editorBinary(kind);
  if (!bin) return false;
  if (process.env.MBLZ_DESKTOP_NO_LAUNCH === "1") return true;
  const child = spawn(bin, [file], { detached: true, stdio: "ignore", shell: false, env: editorEnv() as NodeJS.ProcessEnv, windowsHide: false });
  child.on("error", () => {});
  child.unref();
  return true;
}
