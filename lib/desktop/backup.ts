// Desktop backup and restore.
//
// A backup is one `.lawyermind-backup` file (ZIP) with:
//   manifest.json                   format, applied migrations, counts, SHA-256 of every entry
//   data/<schema>.<table>.json      every row of every application table (one consistent snapshot)
//   files/<storageKey>              the working copies of imported documents (when includesDocuments)
//
// It is logical (rows as JSON read inside one REPEATABLE READ transaction):
// the live PostgreSQL directory is never copied. Each backup is re-read and
// verified after writing. Restore verifies the whole archive first, saves a
// safety backup of the current database, writes document files without ever
// overwriting a different file, and replaces all rows in one transaction.
//
// Database and files together: backup, restore and relocation hold the store
// lock exclusively (imports hold it shared), so no working copy is added,
// restored or relocated between the database snapshot and the file reads.
// Each file is read once — hashed while it is written into the archive —
// through a handle checked against the validated path; if its size or
// modification time changes during the read (a program saving it), the
// backup is aborted instead of recording a torn copy. The working-copy folder
// switched by a restore is stored in the database and changes in the same
// transaction as the rows.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import yazl from "yazl";
import type { PoolClient } from "pg";
import { backupsDir, desktopVersion, DesktopError } from "./env";
import { qi, withClient } from "./db";
import { appliedMigrations } from "./migrate";
import { documentsRoot, setDocumentsRoot } from "./settings";
import { containedPath, ensureContainedDir, fsyncDir, fsyncFile, isInside, openContained, realDir, realPathLoose, resolveStorageKey } from "./paths";
import { withStoreLock } from "./lock";
import { desktopStateDir } from "./env";
import { syncMarker } from "./sync";

export const FORMAT = "lawyermind-backup";
export const FORMAT_VERSION = 2;
export const EXTENSION = ".lawyermind-backup";

export type Manifest = {
  format: string; format_version: number; created_at: string; app_version: string;
  migrations: string[]; tables: string[]; includes_documents: boolean;
  counts: Record<string, number>; entries: Record<string, string>; documents: number; documents_bytes: number;
};

// desktop.local_session is never backed up (sessions are revoked on restore).
const DESKTOP_TABLES = ["desktop.local_account"];

async function appTables(c: PoolClient): Promise<string[]> {
  const r = await c.query<{ t: string }>(
    `select table_schema || '.' || table_name as t from information_schema.tables
     where table_type = 'BASE TABLE' and table_schema = 'public' order by table_name`);
  return [...r.rows.map(x => x.t), ...DESKTOP_TABLES];
}

const ref = (t: string) => t.split(".").map(qi).join(".");
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

function hashing(stream: Readable): { out: PassThrough; digest: Promise<string>; size: Promise<number> } {
  const h = crypto.createHash("sha256"); let n = 0;
  const out = new PassThrough();
  const done = new Promise<void>((res, rej) => { stream.on("end", () => res()); stream.on("error", rej); });
  stream.on("data", (d: Buffer) => { h.update(d); n += d.length; });
  stream.pipe(out);
  return { out, digest: done.then(() => h.digest("hex")), size: done.then(() => n) };
}

export type BackupReport = { path: string; bytes: number; includes_documents: boolean; counts: Record<string, number>; documents: number; documents_bytes: number; verified: true };

type BackupOptions = {
  dest: string; includeDocuments: boolean;
  /** false only when the caller already holds the store lock (restore). */
  lock?: boolean; lockTimeoutMs?: number;
  /** Test hook: called after the first chunk of each document file is read. */
  onFileChunk?: (key: string) => void;
};

export function createBackup(opts: BackupOptions): Promise<BackupReport> {
  return opts.lock === false ? createBackupLocked(opts) : withStoreLock("exclusive", () => createBackupLocked(opts), opts.lockTimeoutMs);
}

async function createBackupLocked(opts: BackupOptions): Promise<BackupReport> {
  if (!path.isAbsolute(opts.dest)) throw new DesktopError("Escolha onde salvar o backup.", 400);
  const dest = path.normalize(opts.dest.endsWith(EXTENSION) ? opts.dest : opts.dest + EXTENSION);
  if (fs.existsSync(dest)) throw new DesktopError("Já existe um arquivo com esse nome. Escolha outro nome para o backup.", 409, "exists");
  const root = opts.includeDocuments ? await documentsRoot() : "";
  if (opts.includeDocuments && isInside(realPathLoose(root), realPathLoose(dest))) throw new DesktopError("Salve o backup fora da pasta de cópias de trabalho.", 400);

  const snapshot = await withClient(async c => {
    await c.query("begin isolation level repeatable read read only");
    try {
      const tables = await appTables(c);
      const data: { table: string; json: string; count: number }[] = [];
      for (const t of tables) {
        const r = await c.query<{ j: string; n: string }>(`select coalesce(json_agg(t), '[]'::json)::text as j, count(*)::text as n from ${ref(t)} t`);
        data.push({ table: t, json: r.rows[0].j, count: Number(r.rows[0].n) });
      }
      const keys = await c.query<{ k: string }>(`select distinct "storageKey" as k from "DocumentVersion" where "storageKey" is not null and source = 'DESKTOP_IMPORT' order by 1`);
      return { tables, data, keys: keys.rows.map(r => r.k), migrations: await appliedMigrations(c) };
    } finally { await c.query("commit"); }
  });

  const files: string[] = [];
  if (opts.includeDocuments) {
    const missing: string[] = [];
    for (const key of snapshot.keys) {
      try { containedPath(root, key, "file"); files.push(key); }
      catch (e) { if (e instanceof DesktopError && (e.code === "missing" || e.code === "missing-root")) missing.push(key); else throw e; }
    }
    if (missing.length) throw new DesktopError(`${missing.length} cópia(s) de trabalho não foram encontradas em ${root} (ex.: ${missing[0]}). Relocalize a pasta de documentos antes do backup.`, 409, "missing-documents");
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const partial = path.join(path.dirname(dest), `.${path.basename(dest)}.partial-${crypto.randomUUID()}`);
  const zip = new yazl.ZipFile();
  let out: fs.WriteStream | null = null, written: Promise<void> | null = null;
  try {
    const entries: Record<string, string> = {};
    const counts: Record<string, number> = {};
    out = fs.createWriteStream(partial);
    written = pipeline(zip.outputStream, out);
    written.catch(() => {});
    for (const d of snapshot.data) {
      const name = `data/${d.table}.json`;
      entries[name] = sha(d.json); counts[d.table] = d.count;
      zip.addBuffer(Buffer.from(d.json, "utf8"), name, { compress: true });
    }
    // One read per file, hashed on the way into the archive, through a handle
    // that is checked to be the validated (link-free) file.
    let bytes = 0;
    for (const key of files) {
      const name = `files/${key}`;
      const { fd, stat: before } = openContained(root, key);
      try {
        const reader = fs.createReadStream("", { fd, autoClose: false });
        let first = true;
        if (opts.onFileChunk) reader.on("data", () => { if (first) { first = false; opts.onFileChunk!(key); } });
        const h = hashing(reader);
        zip.addReadStream(h.out, name, { compress: false, mtime: before.mtime });
        entries[name] = await h.digest;
        const size = await h.size;
        const after = fs.fstatSync(fd);
        if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
          throw new DesktopError(`A cópia de trabalho ${key} foi alterada durante o backup (talvez esteja aberta e salvando). Feche o documento e faça o backup de novo. Nenhum backup foi gravado.`, 409, "changed");
        }
        bytes += size;
      } finally { fs.closeSync(fd); }
    }
    const manifest: Manifest = {
      format: FORMAT, format_version: FORMAT_VERSION, created_at: new Date().toISOString(), app_version: desktopVersion(),
      migrations: snapshot.migrations, tables: snapshot.tables, includes_documents: opts.includeDocuments,
      counts, entries, documents: files.length, documents_bytes: bytes,
    };
    zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), "manifest.json");
    zip.end();
    await written;
    const fd = fs.openSync(partial, "r+"); fs.fsyncSync(fd); fs.closeSync(fd);
    if (fs.existsSync(dest)) throw new DesktopError("Já existe um arquivo com esse nome.", 409, "exists");
    fs.renameSync(partial, dest);
    fsyncDir(path.dirname(dest));
  } catch (e) {
    (zip.outputStream as unknown as Readable).destroy();
    out?.destroy();
    await written?.catch(() => {});
    fs.rmSync(partial, { force: true });
    throw e;
  }
  const m = await verifyBackup(dest);
  return { path: dest, bytes: fs.statSync(dest).size, includes_documents: m.includes_documents, counts: m.counts, documents: m.documents, documents_bytes: m.documents_bytes, verified: true };
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((res, rej) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (e, z) => e || !z ? rej(e ?? new Error("zip")) : res(z)));
}

async function forEachEntry(file: string, fn: (entry: yauzl.Entry, open: () => Promise<Readable>) => Promise<void>) {
  const zip = await openZip(file);
  try {
    await new Promise<void>((res, rej) => {
      zip.on("entry", (entry: yauzl.Entry) => {
        const open = () => new Promise<Readable>((ok, ko) => zip.openReadStream(entry, (e, s) => e || !s ? ko(e ?? new Error("stream")) : ok(s)));
        fn(entry, open).then(() => zip.readEntry(), rej);
      });
      zip.on("end", () => res());
      zip.on("error", rej);
      zip.readEntry();
    });
  } finally { zip.close(); }
}

async function readAll(s: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []; for await (const c of s) chunks.push(c as Buffer); return Buffer.concat(chunks);
}

async function streamSha(s: Readable): Promise<string> {
  const h = crypto.createHash("sha256"); for await (const c of s) h.update(c as Buffer); return h.digest("hex");
}

function safeEntryName(name: string) {
  if (name !== "manifest.json" && !/^data\/[a-z_]+\.[A-Za-z0-9_]+\.json$/.test(name) && !name.startsWith("files/")) throw new DesktopError(`Entrada inesperada no backup: ${name}`, 422);
  if (name.startsWith("files/")) resolveStorageKey("/x", name.slice(6));
}

export async function readManifest(file: string): Promise<Manifest> {
  let manifest: Manifest | null = null;
  await forEachEntry(file, async (e, open) => { if (e.fileName === "manifest.json") manifest = JSON.parse((await readAll(await open())).toString("utf8")); });
  if (!manifest) throw new DesktopError("Este arquivo não é um backup do LawyerMind.", 422);
  const m = manifest as Manifest;
  if (m.format !== FORMAT || m.format_version !== FORMAT_VERSION) throw new DesktopError("Formato de backup incompatível com esta versão do LawyerMind.", 422);
  return m;
}

/** Reads every entry and checks it against the manifest. */
export async function verifyBackup(file: string): Promise<Manifest> {
  try { return await verifyBackupStrict(file); }
  catch (e) { if (e instanceof DesktopError) throw e; throw new DesktopError("Backup ilegível ou corrompido.", 422, "corrupt"); }
}

async function verifyBackupStrict(file: string): Promise<Manifest> {
  if (!path.isAbsolute(file) || !fs.existsSync(file)) throw new DesktopError("Arquivo de backup não encontrado.", 404);
  const m = await readManifest(file);
  const seen = new Set<string>();
  await forEachEntry(file, async (e, open) => {
    if (e.fileName === "manifest.json") return;
    safeEntryName(e.fileName);
    const expected = m.entries[e.fileName];
    if (!expected) throw new DesktopError(`Entrada não declarada no manifesto: ${e.fileName}`, 422);
    if (await streamSha(await open()) !== expected) throw new DesktopError(`Backup corrompido: checksum divergente em ${e.fileName}.`, 422);
    seen.add(e.fileName);
  });
  for (const name of Object.keys(m.entries)) if (!seen.has(name)) throw new DesktopError(`Backup incompleto: falta ${name}.`, 422);
  for (const t of m.tables) if (!m.entries[`data/${t}.json`]) throw new DesktopError(`Backup sem a tabela ${t}.`, 422);
  if (!m.includes_documents && Object.keys(m.entries).some(n => n.startsWith("files/"))) throw new DesktopError("Manifesto inconsistente.", 422);
  return m;
}

export type RestoreReport = { restored_from: string; safety_backup: string; counts: Record<string, number>; includes_documents: boolean; documents_root: string; documents_written: number; documents_already_present: number };

type RestoreOptions = {
  file: string; documentsTarget?: string | null; lockTimeoutMs?: number;
  /** Test hook: runs inside the transaction, after the rows and the folder were replaced, before commit. */
  beforeCommit?: () => Promise<void>;
};

export function restoreBackup(opts: RestoreOptions): Promise<RestoreReport> {
  return withStoreLock("exclusive", () => restoreLocked(opts), opts.lockTimeoutMs);
}

async function restoreLocked(opts: RestoreOptions): Promise<RestoreReport> {
  const m = await verifyBackup(opts.file);
  const current = await withClient(c => appliedMigrations(c));
  if (JSON.stringify(current) !== JSON.stringify(m.migrations)) {
    throw new DesktopError("O backup foi criado com outra versão do banco (migrações diferentes). Restauração entre versões ainda não é suportada.", 409, "schema-mismatch");
  }
  const tables = await withClient(c => appTables(c));
  if (JSON.stringify([...tables].sort()) !== JSON.stringify([...m.tables].sort())) throw new DesktopError("As tabelas do backup não correspondem às desta versão.", 409, "schema-mismatch");

  // Plan document writes before changing anything.
  const fileEntries = Object.entries(m.entries).filter(([n]) => n.startsWith("files/"));
  let target = await documentsRoot();
  const toWrite: { name: string; key: string; sha: string }[] = [];
  let already = 0;
  if (m.includes_documents) {
    if (!opts.documentsTarget || !path.isAbsolute(opts.documentsTarget)) throw new DesktopError("Escolha a pasta onde as cópias de trabalho serão restauradas.", 400);
    target = path.normalize(opts.documentsTarget);
    const marker = syncMarker(target);
    if (marker) throw new DesktopError(`A pasta de cópias de trabalho não pode ficar em pasta sincronizada ("${marker}").`, 400, "synced");
    const real = realPathLoose(target);
    for (const reserved of ["pgdata", "backups", "leitura"]) {
      const r = realPathLoose(path.join(desktopStateDir(), reserved));
      if (isInside(r, real) || isInside(real, r)) throw new DesktopError("Escolha uma pasta fora das pastas internas do LawyerMind (banco, backups).", 400);
    }
    if (fs.existsSync(target)) {
      if (!fs.statSync(target).isDirectory()) throw new DesktopError("O destino não é uma pasta.", 400);
      target = realDir(target);
    }
    for (const [name, digest] of fileEntries) {
      const key = name.slice(6);
      // Refuses links/junctions anywhere below the target, existing or not.
      const existing = fs.existsSync(target) ? containedPath(target, key, "any") : null;
      if (existing && fs.existsSync(existing)) {
        const { fd } = openContained(target, key);
        let same: boolean;
        try { same = await streamSha(fs.createReadStream("", { fd, autoClose: false })) === digest; } finally { fs.closeSync(fd); }
        if (same) { already++; continue; }
        throw new DesktopError(`A pasta escolhida já contém um arquivo diferente em ${key}. Escolha uma pasta vazia.`, 409, "conflict");
      }
      toWrite.push({ name, key, sha: digest });
    }
  }

  // Safety copy of the current database before replacing it.
  fs.mkdirSync(backupsDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safety = await createBackup({ dest: path.join(backupsDir(), `antes-da-restauracao-${stamp}${EXTENSION}`), includeDocuments: false, lock: false });

  // Extract document files (temp + rename, verified, never through a link).
  const want = new Map(toWrite.map(w => [w.name, w]));
  let written = 0;
  if (m.includes_documents) {
    fs.mkdirSync(target, { recursive: true });
    target = realDir(target);
  }
  if (want.size) {
    await forEachEntry(opts.file, async (e, open) => {
      const w = want.get(e.fileName); if (!w) return;
      const dir = ensureContainedDir(target, w.key.split("/").slice(0, -1).join("/"));
      const tmp = path.join(dir, `.lawyermind-tmp-${crypto.randomUUID()}`);
      try {
        const h = hashing(await open());
        await pipeline(h.out, fs.createWriteStream(tmp, { flags: "wx" }));
        if (await h.digest !== w.sha) throw new DesktopError(`Checksum divergente ao extrair ${e.fileName}.`, 422);
        fsyncFile(tmp);
        fs.renameSync(tmp, containedPath(target, w.key, "absent"));
        fsyncDir(dir); // the restored file survives a power loss before the database commit
        written++;
      } finally { fs.rmSync(tmp, { force: true }); }
    });
  }

  // Replace rows atomically.
  const data = new Map<string, string>();
  await forEachEntry(opts.file, async (e, open) => {
    if (e.fileName.startsWith("data/")) data.set(e.fileName.slice(5, -5), (await readAll(await open())).toString("utf8"));
  });
  const counts = await withClient(async c => {
    await c.query("begin");
    try {
      await c.query("set local session_replication_role = replica");
      // The text index is derived from the working copies: cleared and rebuilt on the next search.
      await c.query(`truncate ${[...tables, "desktop.local_session", "desktop.document_text"].map(ref).join(", ")}`);
      for (const t of tables) {
        await c.query(`insert into ${ref(t)} select * from json_populate_recordset(null::${ref(t)}, $1::json)`, [data.get(t) ?? "[]"]);
      }
      const out: Record<string, number> = {};
      for (const t of tables) out[t] = Number((await c.query<{ n: string }>(`select count(*)::text as n from ${ref(t)}`)).rows[0].n);
      for (const t of tables) if (out[t] !== m.counts[t]) throw new DesktopError(`Contagem divergente em ${t} após restaurar; nada foi alterado.`, 500);
      // The working-copy folder switches in the same transaction as the rows.
      if (m.includes_documents) await setDocumentsRoot(target, c);
      await opts.beforeCommit?.();
      await c.query("commit");
      return out;
    } catch (e) { await c.query("rollback"); throw e; }
  });

  return { restored_from: opts.file, safety_backup: safety.path, counts, includes_documents: m.includes_documents, documents_root: target, documents_written: written, documents_already_present: already };
}
