// Reading preferences per person, stored in the database (so they survive
// restarts and follow the account) and applied on <html> by the root layout.
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const FONT_SCALES = [100, 115, 130, 150] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export const THEMES = ["system", "light", "dark"] as const;

export type DisplayPreferences = { fontScale: (typeof FONT_SCALES)[number]; density: (typeof DENSITIES)[number]; theme: (typeof THEMES)[number] };
import { DEFAULT_PREFERENCES } from "./preferences-defaults";
export { DEFAULT_PREFERENCES };

export const preferencesInput = z.object({
  fontScale: z.union([z.literal(100), z.literal(115), z.literal(130), z.literal(150)]),
  density: z.enum(DENSITIES),
  theme: z.enum(THEMES),
}).strict();

function coerce(row: { fontScale: number; density: string; theme: string } | null): DisplayPreferences {
  // 90 % was offered before the minimum became the 16 px base; it reads as 100 %.
  const p = preferencesInput.safeParse(row ? { fontScale: row.fontScale === 90 ? 100 : row.fontScale, density: row.density, theme: row.theme } : null);
  return p.success ? p.data : DEFAULT_PREFERENCES;
}

export async function getDisplayPreferences(userId: string | null | undefined): Promise<DisplayPreferences> {
  if (!userId) return DEFAULT_PREFERENCES;
  try {
    return coerce(await prisma.userDisplayPreference.findUnique({ where: { userId }, select: { fontScale: true, density: true, theme: true } }));
  } catch (e) {
    // A database not migrated yet must not take the whole interface down.
    console.error("[preferences]", e instanceof Error ? e.message : e);
    return DEFAULT_PREFERENCES;
  }
}

export async function saveDisplayPreferences(userId: string, prefs: DisplayPreferences): Promise<DisplayPreferences> {
  const data = preferencesInput.parse(prefs);
  await prisma.userDisplayPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  return data;
}

export async function resetDisplayPreferences(userId: string): Promise<DisplayPreferences> {
  await prisma.userDisplayPreference.deleteMany({ where: { userId } });
  return DEFAULT_PREFERENCES;
}

/** Attributes for <html>: CSS reads data-theme, data-density and --fs. */
export function htmlAttributes(p: DisplayPreferences) {
  return { "data-theme": p.theme, "data-density": p.density, style: { ["--fs" as string]: String(p.fontScale / 100) } as React.CSSProperties };
}
