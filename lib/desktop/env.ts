// Desktop (Tauri) runtime switches. The desktop shell starts the standalone
// Next.js server with MBLZ_DESKTOP=1; the web/Render deployment never sets it,
// so every desktop code path is inert there.
import path from "node:path";

export const isDesktop = () => process.env.MBLZ_DESKTOP === "1";

export class DesktopError extends Error {
  constructor(message: string, public status = 400, public code?: string) { super(message); }
}

export function desktopStateDir(): string {
  const dir = process.env.MBLZ_DESKTOP_STATE_DIR;
  if (!isDesktop() || !dir) throw new DesktopError("Recurso disponível apenas no aplicativo desktop.", 404);
  return dir;
}

export const desktopVersion = () => process.env.MBLZ_DESKTOP_VERSION ?? "dev";

/** Prisma migration folders shipped with the app (resources/server/prisma/migrations), set by the desktop shell. */
export function migrationsDir(): string {
  const dir = process.env.MBLZ_DESKTOP_MIGRATIONS_DIR;
  if (!dir) throw new DesktopError("MBLZ_DESKTOP_MIGRATIONS_DIR não definido.", 500);
  return dir;
}

export const backupsDir = () => path.join(desktopStateDir(), "backups");
