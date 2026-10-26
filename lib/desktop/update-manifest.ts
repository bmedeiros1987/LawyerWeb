// Contract for the update manifest published next to a GitHub release (asset `update-manifest.json`).
// The `platforms` map mirrors the Tauri updater's static JSON so it can be converted later; the
// extra fields (sha256, size, minimumInstalledVersion) are ours. Nothing here downloads anything.
import { z } from "zod";

export const MANIFEST_ASSET = "update-manifest.json";
export const MANIFEST_SCHEMA = "mblz-update-manifest-v1";
export const REPO_DOWNLOAD_PREFIX = "/bmedeiros1987/LawyerWeb/releases/download/";
export const MAX_PACKAGE_BYTES = 1024 ** 3;

export const TARGETS = ["windows-x86_64", "darwin-aarch64", "darwin-x86_64", "linux-x86_64"] as const;
export type UpdateTarget = (typeof TARGETS)[number];

/** Node platform/arch → target. Apple Silicon and Intel are separate packages; anything else is unsupported. */
export function updateTarget(platform: string, arch: string): UpdateTarget | null {
  if (platform === "win32" && arch === "x64") return "windows-x86_64";
  if (platform === "darwin" && arch === "arm64") return "darwin-aarch64";
  if (platform === "darwin" && arch === "x64") return "darwin-x86_64";
  if (platform === "linux" && arch === "x64") return "linux-x86_64";
  return null;
}

const EXTENSION: Record<UpdateTarget, RegExp> = {
  "windows-x86_64": /\.exe$/i,
  "darwin-aarch64": /\.(dmg|app\.tar\.gz)$/i,
  "darwin-x86_64": /\.(dmg|app\.tar\.gz)$/i,
  "linux-x86_64": /\.(deb|AppImage)$/i,
};
const ARM = /(aarch64|arm64)/i, INTEL = /(x86_64|x64|amd64|intel)/i;

const packageSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/),
  url: z.string().max(600),
  size: z.number().int().positive().max(MAX_PACKAGE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  signature: z.string().min(1).max(4096),
}).strict();
export type UpdatePackage = z.infer<typeof packageSchema> & { target: UpdateTarget };

const version = z.string().regex(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const manifestSchema = z.object({
  schema: z.literal(MANIFEST_SCHEMA),
  version,
  notes: z.string().max(16000),
  pubDate: z.string().max(40),
  minimumInstalledVersion: version,
  platforms: z.object(Object.fromEntries(TARGETS.map(t => [t, packageSchema.optional()])) as Record<UpdateTarget, z.ZodOptional<typeof packageSchema>>).strict(),
}).strict();
export type UpdateManifest = z.infer<typeof manifestSchema>;

export function packageUrlFor(tag: string, name: string): string {
  return `https://github.com${REPO_DOWNLOAD_PREFIX}${encodeURIComponent(tag)}/${name}`;
}

/** Parses and cross-checks a manifest against the release tag. Throws a readable Error when it is not trustworthy. */
export function parseManifest(value: unknown, tag: string): UpdateManifest {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) throw new Error("Manifesto de atualização malformado.");
  const manifest = parsed.data;
  if (manifest.version.replace(/^v/, "") !== tag.replace(/^v/, "")) throw new Error("Versão do manifesto diverge da tag da release.");
  if (Number.isNaN(Date.parse(manifest.pubDate))) throw new Error("Data do manifesto inválida.");
  for (const target of TARGETS) {
    const entry = manifest.platforms[target];
    if (!entry) continue;
    if (entry.url !== packageUrlFor(tag, entry.name)) throw new Error(`Link do pacote ${target} fora da release.`);
    if (!EXTENSION[target].test(entry.name)) throw new Error(`Tipo de arquivo inesperado para ${target}.`);
    const arm = ARM.test(entry.name), intel = INTEL.test(entry.name);
    if (target === "darwin-aarch64" && intel && !arm) throw new Error("Pacote Intel listado para Apple Silicon.");
    if (target === "darwin-x86_64" && arm) throw new Error("Pacote Apple Silicon listado para Intel.");
  }
  return manifest;
}

export function packageFor(manifest: UpdateManifest, target: UpdateTarget): UpdatePackage | null {
  const entry = manifest.platforms[target];
  return entry ? { ...entry, target } : null;
}
