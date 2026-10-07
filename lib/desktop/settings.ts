// Per-computer settings (not stored in the database nor in backups).
import fs from "node:fs";
import path from "node:path";
import { desktopStateDir } from "./env";

export type DesktopSettings = { documentsRoot?: string };

const file = () => path.join(desktopStateDir(), "settings.json");

export function readSettings(): DesktopSettings {
  try { return JSON.parse(fs.readFileSync(file(), "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}; throw e; }
}

export function writeSettings(next: DesktopSettings) {
  const tmp = file() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file());
}

/** Working-copy store: app-managed, outside any synced folder. Default: inside the app data dir. */
export function documentsRoot(): string {
  return readSettings().documentsRoot ?? path.join(desktopStateDir(), "documentos");
}
