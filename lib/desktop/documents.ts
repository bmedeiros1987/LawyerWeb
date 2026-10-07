// Desktop documents: originals are read-only, work happens on a copy.
//
// - Import is always explicit (the user picks a file). The original — on the
//   Drive or anywhere else — is opened read-only and never edited, overwritten,
//   moved, renamed or deleted. If it changes while being read, the import is
//   aborted.
// - The copy ("cópia de trabalho") is stored in the documents root, an
//   app-managed folder that must not be inside a synced folder, at
//   ws/<workspaceId>/<documentId>/v<version>-<name>. Edits (and any autosave of
//   the program that opens it) only touch this copy. Opening the editable copy
//   requires documents.edit; with view permission only, a read-only temporary
//   copy is opened instead.
// - Nothing below the documents root may be a symbolic link, junction or hard
//   link (paths.ts): a link could make a read, write or "open" reach a file
//   outside the authorized folder.
// - Export always writes a new file at a destination the user chose; replacing
//   an existing file requires the explicit confirmation "SOBRESCREVER". Export
//   destinations may be synced folders (the UI warns about partial sync and
//   conflicts between computers).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { prisma } from "@/lib/prisma";
import { desktopStateDir, DesktopError } from "./env";
import { containedPath, ensureContainedDir, fsyncDir, isInside, openContained, realDir, realPathLoose, safeName } from "./paths";
import { documentsRoot, setDocumentsRoot } from "./settings";
import { withStoreLock } from "./lock";
import { syncMarker } from "./sync";

export const SOURCE = "DESKTOP_IMPORT";
export const OVERWRITE_CONFIRMATION = "SOBRESCREVER";
const MAX_BYTES = 2 * 1024 ** 3;

const MIME: Record<string, string> = {
  ".pdf": "application/pdf", ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".odt": "application/vnd.oasis.opendocument.text", ".rtf": "application/rtf", ".txt": "text/plain", ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".eml": "message/rfc822",
};

export async function ensureWorkingRoot(): Promise<string> {
  const root = await documentsRoot();
  const marker = syncMarker(root);
  if (marker) throw new DesktopError(`A pasta de cópias de trabalho está em pasta sincronizada ("${marker}"). Relocalize-a para uma pasta local em Computador.`, 409, "synced");
  fs.mkdirSync(root, { recursive: true });
  return realDir(root);
}

type ImportInput = {
  userId: string; workspaceId: string; sourcePath: string;
  clientId?: string | null; matterId?: string | null; documentId?: string | null; name?: string | null; kind?: string | null;
};

export function importDocument(input: ImportInput) {
  return withStoreLock("shared", () => importLocked(input));
}

async function importLocked(input: ImportInput) {
  const source = input.sourcePath;
  if (!source || !path.isAbsolute(source)) throw new DesktopError("Escolha o arquivo a importar.", 400);
  const root = await ensureWorkingRoot();
  const realSource = realPathLoose(source);
  if (isInside(root, realSource)) throw new DesktopError("Este arquivo já é uma cópia de trabalho do LawyerMind.", 400);
  if (isInside(realPathLoose(desktopStateDir()), realSource)) throw new DesktopError("Escolha um arquivo fora da pasta de dados do LawyerMind.", 400);

  // Read-only: the only handle ever opened on the original is "r".
  let fd: number;
  try { fd = fs.openSync(source, "r"); } catch { throw new DesktopError("Não foi possível ler o arquivo escolhido.", 400); }
  let tmp: string;
  try { tmp = path.join(ensureContainedDir(root, `ws/${input.workspaceId}/.importando`), crypto.randomUUID()); }
  catch (e) { fs.closeSync(fd); throw e; }
  let digest: string, size: number, before: fs.Stats;
  try {
    before = fs.fstatSync(fd);
    if (!before.isFile()) throw new DesktopError("Escolha um arquivo (não uma pasta).", 400);
    if (before.size > MAX_BYTES) throw new DesktopError("Arquivo maior que 2 GB.", 413);
    const h = crypto.createHash("sha256");
    const reader = fs.createReadStream("", { fd, autoClose: false });
    reader.on("data", d => h.update(d as Buffer));
    await pipeline(reader, fs.createWriteStream(tmp, { flags: "wx" }));
    const after = fs.fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new DesktopError("O arquivo original mudou durante a cópia (talvez esteja sincronizando). Tente novamente.", 409);
    digest = h.digest("hex"); size = after.size;
    const out = fs.openSync(tmp, "r+"); fs.fsyncSync(out); fs.closeSync(out);
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  finally { fs.closeSync(fd); }

  const originalName = path.basename(source);
  const ext = path.extname(originalName).toLowerCase();
  const provenance = {
    originalPath: path.resolve(source), originalSize: size, originalModifiedAt: before.mtime.toISOString(),
    originalInSyncFolder: syncMarker(source), importedAt: new Date().toISOString(), originalTreatedAsReadOnly: true,
  };

  let placed: string | null = null;
  try {
    return await prisma.$transaction(async tx => {
      if (input.clientId && !(await tx.client.findFirst({ where: { id: input.clientId, workspaceId: input.workspaceId } }))) throw new DesktopError("Cliente não encontrado neste workspace.", 404);
      if (input.matterId && !(await tx.matter.findFirst({ where: { id: input.matterId, workspaceId: input.workspaceId } }))) throw new DesktopError("Processo não encontrado neste workspace.", 404);
      let documentId = input.documentId ?? null;
      let version = 1;
      if (documentId) {
        // Row lock: concurrent imports of new versions of the same document get consecutive numbers.
        const locked = await tx.$queryRaw<{ id: string }[]>`select id from "LegalDocument" where id = ${documentId} and "workspaceId" = ${input.workspaceId} for update`;
        if (!locked.length) throw new DesktopError("Documento não encontrado.", 404);
        const last = await tx.documentVersion.aggregate({ where: { documentId }, _max: { version: true } });
        version = (last._max.version ?? 0) + 1;
        await tx.legalDocument.update({ where: { id: documentId }, data: { currentVersion: version } });
      } else {
        const doc = await tx.legalDocument.create({ data: {
          workspaceId: input.workspaceId, clientId: input.clientId || null, matterId: input.matterId || null,
          name: (input.name?.trim() || path.basename(originalName, ext) || "Documento").slice(0, 200),
          kind: input.kind || "OTHER", createdByUserId: input.userId, currentVersion: 1,
        } });
        documentId = doc.id;
      }
      const key = `ws/${input.workspaceId}/${documentId}/v${version}-${safeName(originalName)}`;
      containedPath(root, key, "absent");
      const created = await tx.documentVersion.create({ data: {
        documentId, version, mimeType: MIME[ext] ?? null, storageKey: key, originalName, sha256: digest,
        source: SOURCE, notes: JSON.stringify(provenance), createdByUserId: input.userId,
      } });
      await tx.activityLog.create({ data: {
        workspaceId: input.workspaceId, userId: input.userId, type: "DOCUMENT_IMPORTED", entityType: "LegalDocument", entityId: documentId,
        summary: `Cópia de trabalho importada: ${originalName} (versão ${version})`, source: "DESKTOP",
        metadata: { sha256: digest, size, originalInSyncFolder: provenance.originalInSyncFolder },
      } });
      ensureContainedDir(root, key.split("/").slice(0, -1).join("/"));
      const dest = containedPath(root, key, "absent");
      fs.renameSync(tmp, dest);
      fsyncDir(path.dirname(dest));
      placed = dest; // removed again if the transaction does not commit
      return { documentId, versionId: created.id, version, storageKey: key, sha256: digest, size, originalInSyncFolder: provenance.originalInSyncFolder };
    });
  } catch (e) {
    if (placed) fs.rmSync(placed, { force: true });
    throw e;
  } finally { fs.rmSync(tmp, { force: true }); }
}

/** Path of a working copy the member may access (caller checks permissions/scope). */
export async function workingCopyPath(versionId: string, workspaceId: string) {
  const v = await prisma.documentVersion.findFirst({ where: { id: versionId, source: SOURCE, document: { workspaceId } }, include: { document: true } });
  if (!v?.storageKey) throw new DesktopError("Cópia de trabalho não encontrada.", 404);
  const root = await documentsRoot();
  try { return { file: containedPath(root, v.storageKey, "file"), root, version: v }; }
  catch (e) {
    if (e instanceof DesktopError && (e.code === "missing" || e.code === "missing-root")) throw new DesktopError(`A cópia de trabalho não está na pasta de documentos atual (${root}). Se a pasta foi movida, relocalize-a em Computador.`, 409, "missing");
    throw e;
  }
}

const READ_COPIES_HOURS = 24;

/**
 * Read-only temporary copy for members without documents.edit: written to
 * <dados>/leitura/<id>/<nome> and marked read-only, so the editable working
 * copy is never handed to them. Old read copies are removed on the next call.
 */
export async function readOnlyCopy(versionId: string, workspaceId: string): Promise<string> {
  const { file, root, version } = await workingCopyPath(versionId, workspaceId);
  const base = path.join(desktopStateDir(), "leitura");
  fs.mkdirSync(base, { recursive: true });
  for (const d of fs.readdirSync(base)) {
    const p = path.join(base, d);
    try {
      const st = fs.lstatSync(p);
      if (Date.now() - st.mtimeMs < READ_COPIES_HOURS * 3600_000) continue;
      if (st.isDirectory()) for (const f of fs.readdirSync(p)) fs.chmodSync(path.join(p, f), 0o600);
      fs.rmSync(p, { recursive: true, force: true });
    } catch { /* still open in another program: removed later */ }
  }
  const dir = path.join(base, crypto.randomUUID());
  fs.mkdirSync(dir);
  const dest = path.join(dir, safeName(version.originalName ?? path.basename(file)));
  const { fd } = openContained(root, version.storageKey!);
  try { await pipeline(fs.createReadStream("", { fd, autoClose: false }), fs.createWriteStream(dest, { flags: "wx" })); }
  finally { fs.closeSync(fd); }
  fs.chmodSync(dest, 0o444);
  return dest;
}

/** Opens a file with the system's default program (never the original). */
export function openWithSystem(file: string, reveal = false) {
  // Set only by the packaged self-test, so automated runs do not launch programs.
  if (process.env.MBLZ_DESKTOP_NO_LAUNCH === "1") return;
  const [cmd, args] = process.platform === "win32"
    ? ["explorer.exe", [reveal ? path.dirname(file) : file]]
    : process.platform === "darwin" ? ["open", reveal ? ["-R", file] : [file]] : ["xdg-open", [reveal ? path.dirname(file) : file]];
  const child = spawn(/*turbopackIgnore: true*/ cmd as string, args as string[], { detached: true, stdio: "ignore", shell: false, windowsHide: false });
  child.on("error", () => {});
  child.unref();
}

export async function exportVersion(input: { versionId: string; workspaceId: string; destPath: string; overwrite?: boolean; confirmation?: string }) {
  const { root, version } = await workingCopyPath(input.versionId, input.workspaceId);
  const dest = input.destPath;
  if (!dest || !path.isAbsolute(dest)) throw new DesktopError("Escolha onde salvar o arquivo exportado.", 400);
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new DesktopError("A pasta de destino não existe.", 400);
  // Physical location of the destination folder: a link pointing into the
  // working copies or the app data is refused like the folder itself.
  const realDest = path.join(fs.realpathSync.native(dir), path.basename(dest));
  if (isInside(realDir(root), realDest)) throw new DesktopError("Exporte para uma pasta fora da pasta de cópias de trabalho.", 400);
  if (isInside(realPathLoose(desktopStateDir()), realDest)) throw new DesktopError("Destino inválido.", 400);
  let destStat: fs.Stats | null = null;
  try { destStat = fs.lstatSync(dest); } catch { /* new file */ }
  if (destStat?.isSymbolicLink()) throw new DesktopError("O destino é um link simbólico ou atalho. Escolha um arquivo comum.", 400, "link");
  const exists = Boolean(destStat);
  if (destStat?.isDirectory()) throw new DesktopError("O destino é uma pasta.", 400);
  if (exists && !input.overwrite) throw new DesktopError("Já existe um arquivo com esse nome no destino. Nada foi alterado.", 409, "exists");
  if (exists && input.confirmation !== OVERWRITE_CONFIRMATION) throw new DesktopError(`Para substituir o arquivo existente, digite ${OVERWRITE_CONFIRMATION}.`, 409, "confirm");
  const tmp = path.join(dir, `.lawyermind-export-${crypto.randomUUID()}`);
  try {
    const src = openContained(root, version.storageKey!);
    try { await pipeline(fs.createReadStream("", { fd: src.fd, autoClose: false }), fs.createWriteStream(tmp, { flags: "wx" })); }
    finally { fs.closeSync(src.fd); }
    const fd = fs.openSync(tmp, "r+"); fs.fsyncSync(fd); fs.closeSync(fd);
    if (!exists && fs.existsSync(dest)) throw new DesktopError("Um arquivo com esse nome surgiu no destino. Nada foi alterado.", 409, "exists");
    fs.renameSync(tmp, dest);
  } finally { fs.rmSync(tmp, { force: true }); }
  return { path: dest, replaced: exists, syncFolder: syncMarker(dest) };
}

// ---- working-copy store location (whole installation; owner only) --------

export async function checkRoot(candidate: string) {
  const versions = await prisma.documentVersion.findMany({ where: { source: SOURCE, storageKey: { not: null } }, select: { storageKey: true } });
  let found = 0; const missing: string[] = []; const links: string[] = [];
  const exists = fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
  for (const v of versions) {
    try { if (!exists) throw new DesktopError("", 404, "missing"); containedPath(candidate, v.storageKey!, "file"); found++; }
    catch (e) { if (e instanceof DesktopError && e.code === "link") links.push(v.storageKey!); else missing.push(v.storageKey!); }
  }
  return { root: path.resolve(candidate), exists, total: versions.length, found, missing: missing.length, missingSamples: missing.slice(0, 5), links: links.length, linkSamples: links.slice(0, 5), syncFolder: syncMarker(candidate) };
}

/** Explicit relocation: the app never moves the folder itself. */
export function setRoot(candidate: string, force: boolean) {
  return withStoreLock("exclusive", async () => {
    if (!candidate || !path.isAbsolute(candidate)) throw new DesktopError("Escolha uma pasta.", 400);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) throw new DesktopError("A pasta escolhida não existe.", 400);
    const marker = syncMarker(candidate);
    if (marker) throw new DesktopError(`Cópias de trabalho não podem ficar em pasta sincronizada ("${marker}"). Escolha uma pasta local.`, 400, "synced");
    const real = realDir(candidate);
    if (isInside(realPathLoose(path.join(desktopStateDir(), "pgdata")), real) || isInside(real, realPathLoose(path.join(desktopStateDir(), "pgdata")))) throw new DesktopError("Escolha uma pasta fora da pasta do banco.", 400);
    const check = await checkRoot(real);
    if (check.links > 0) throw new DesktopError(`${check.links} cópia(s) nessa pasta passam por link simbólico, junção ou hard link (ex.: ${check.linkSamples[0]}). Nada foi alterado.`, 422, "link");
    if (check.missing > 0 && !force) throw new DesktopError(`${check.missing} de ${check.total} cópia(s) não estão nessa pasta.`, 409, "missing");
    await setDocumentsRoot(real);
    return check;
  });
}
