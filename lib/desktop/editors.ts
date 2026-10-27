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

// System variables a GUI program needs to start (graphics, shell folders, locale). Matched case-insensitively
// because Windows spells them SystemRoot, ProgramData, etc. Nothing from the app (database, keys, tokens).
const ENV_ALLOW = new Set([
  "PATH", "PATHEXT", "COMSPEC", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "TEMP", "TMP", "TMPDIR",
  "PROGRAMDATA", "ALLUSERSPROFILE", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "HOMEDRIVE", "HOMEPATH", "USERNAME", "USERDOMAIN", "COMPUTERNAME",
  "OS", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "LANG", "LC_ALL",
]);

/** Environment handed to the editor: only what a GUI program needs to start; no tokens or app variables. */
export function editorEnv(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined && ENV_ALLOW.has(k.toUpperCase())) env[k] = v;
  env.LAWYERMIND_EDITOR = "1";
  return env;
}

/** The editor's environment plus, for Word, the bundled spelling dictionaries (Hunspell pt_BR) next to the program. */
export function launchEnv(kind: EditorKind, bin: string, source: Record<string, string | undefined> = process.env): Record<string, string> {
  const env = editorEnv(source);
  const dict = path.join(path.dirname(bin), "dictionaries");
  if (kind === "word" && fs.existsSync(dict)) env.WORDCRAFT_DICTIONARIES = dict;
  return env;
}

export type EditorLaunch = { ok: true; pid: number | null; log: string | null } | { ok: false; reason: "not-installed" | "failed"; message: string; log: string | null };
const SETTLE_MS = 2500;

/**
 * Starts the editor on `file` and only says "ok" once it is still running after a short settle time.
 * A program that cannot start (missing file, blocked, crashes at once) is reported with its exit code and
 * where its output went (<dados>/logs/editor-<tipo>.log), never silently treated as opened.
 */
export function openWithEditor(kind: EditorKind, file: string, settleMs = SETTLE_MS): Promise<EditorLaunch> {
  const bin = editorBinary(kind);
  if (!bin) return Promise.resolve({ ok: false, reason: "not-installed", message: "Editor não instalado.", log: null });
  if (process.env.MBLZ_DESKTOP_NO_LAUNCH === "1") return Promise.resolve({ ok: true, pid: null, log: null });
  let log: string | null = null, fd: number | null = null;
  try {
    const dir = path.join(process.env.MBLZ_DESKTOP_STATE_DIR ?? "", "logs");
    if (process.env.MBLZ_DESKTOP_STATE_DIR) {
      fs.mkdirSync(dir, { recursive: true });
      log = path.join(dir, `editor-${kind}.log`);
      if (fs.existsSync(log) && fs.statSync(log).size > 2 * 1024 * 1024) fs.rmSync(log, { force: true });
      fd = fs.openSync(log, "a");
      fs.writeSync(fd, `\n--- ${new Date().toISOString()} abrindo ${path.basename(file)} ---\n`);
    }
  } catch { log = null; fd = null; }
  return new Promise<EditorLaunch>(resolve => {
    let done = false;
    const finish = (r: EditorLaunch) => { if (done) return; done = true; if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } } resolve(r); };
    const child = spawn(bin, [file], { detached: true, stdio: ["ignore", fd ?? "ignore", fd ?? "ignore"], shell: false, env: launchEnv(kind, bin) as NodeJS.ProcessEnv, windowsHide: false });
    child.on("error", e => finish({ ok: false, reason: "failed", message: `não foi possível iniciar (${(e as NodeJS.ErrnoException).code ?? e.name})`, log }));
    child.on("exit", (code, signal) => finish({ ok: false, reason: "failed", message: `fechou logo ao abrir (${signal ? `sinal ${signal}` : `código ${code}`})`, log }));
    setTimeout(() => { if (!done) { child.unref(); finish({ ok: true, pid: child.pid ?? null, log }); } }, settleMs);
  });
}
