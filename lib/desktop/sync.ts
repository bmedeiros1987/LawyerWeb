// Best-effort detection of folders managed by file-sync clients.
//
// The *active* PostgreSQL directory and the documents working store must never
// live in one of them (a sync client copying files under a running database or
// a file being edited causes corruption and conflicts). Exported files and
// finished backups MAY go there; the UI then warns about partial sync and
// conflicts between computers.
//
// Limitations: detection is by path (folder names and known sync roots). A sync
// client configured on an arbitrary folder name, a network share, or a
// virtual drive whose path carries no recognizable name is not detected.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKERS = [
  "google drive", "googledrive", "my drive", "meu drive", "shared drives", "drives compartilhados",
  "onedrive", "dropbox", "icloud drive", "icloud", "icloud~", "mobile documents", "cloudstorage",
  "box", "box sync", "pcloud", "pcloud drive", "mega", "megasync", "nextcloud", "owncloud", "syncthing", "sync",
];

function components(p: string): string[] {
  return path.resolve(p).split(/[\\/]+/).filter(Boolean);
}

function envRoots(): string[] {
  const home = os.homedir();
  const roots = [process.env.OneDrive, process.env.OneDriveCommercial, process.env.OneDriveConsumer].filter(Boolean) as string[];
  roots.push(path.join(home, "Library", "Mobile Documents"), path.join(home, "Library", "CloudStorage"));
  return roots;
}

function within(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent).toLowerCase(), path.resolve(child).toLowerCase());
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Returns a human-readable reason when `p` looks like a synced folder, else null. */
export function syncMarker(p: string): string | null {
  const candidates = [path.resolve(p)];
  // Resolve symlinks/junctions of the deepest existing ancestor.
  let probe = path.resolve(p);
  while (probe && !fs.existsSync(probe)) { const up = path.dirname(probe); if (up === probe) break; probe = up; }
  try { candidates.push(fs.realpathSync.native(probe)); } catch { /* ignore */ }
  for (const c of candidates) {
    for (const root of envRoots()) if (within(c, root)) return root;
    for (const part of components(c)) {
      const name = part.toLowerCase();
      for (const m of MARKERS) {
        if (name === m || name.startsWith(m + "-") || name.startsWith(m + " ") || name.startsWith(m + "_")) return part;
      }
    }
  }
  return null;
}
