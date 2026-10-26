// Text index of the working copies (desktop only), used by content search.
//
// - DOCX/ODT: text of the document body, headers, footers and notes.
// - PDF: text layer, pages separated by "\f" (form feed) so a match can name
//   its page. A PDF without a text layer (a scan) is recorded as "no_text":
//   it needs OCR and is reported as NOT searched.
// - TXT/MD/CSV/EML: read as UTF-8.
// - Anything else is "unsupported" and also reported as not searched.
//
// Each row remembers the size and modification time of the file it read; an
// edited working copy is re-indexed before the next search. The index is
// derived data: not part of backups, cleared on restore and rebuilt.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import yauzl from "yauzl";
import { prisma } from "@/lib/prisma";
import { DesktopError } from "./env";
import { containedPath, openContained } from "./paths";
import { documentsRoot } from "./settings";
import { SOURCE } from "./documents";

export type IndexStatus = "indexed" | "no_text" | "unsupported" | "error";
export type Extracted = { status: IndexStatus; text: string; pages?: number; note?: string };

const MAX_BYTES = 60 * 1024 * 1024;
const TEXT_EXT = new Set([".txt", ".md", ".csv", ".eml"]);

/** Lowercase without accents, same length as the input (so positions map back to the original). */
export function fold(text: string): string {
  let out = "";
  for (const c of text) {
    const f = c.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
    out += f.length === c.length ? f : c.toLowerCase().length === c.length ? c.toLowerCase() : c;
  }
  return out;
}

function decodeXml(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");
}

/** WordprocessingML / ODF XML to plain text: one line per paragraph, tabs and breaks kept. */
export function xmlToText(xml: string): string {
  return decodeXml(xml
    .replace(/<w:tab\/>|<text:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>|<text:line-break\/>/g, "\n")
    .replace(/<\/w:p>|<\/text:p>|<\/text:h>/g, "\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/[  ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function zipEntries(buf: Buffer, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("zip"));
      const out = new Map<string, string>();
      zip.on("entry", (e: yauzl.Entry) => {
        if (!wanted(e.fileName) || e.uncompressedSize > 50 * 1024 * 1024) return zip.readEntry();
        zip.openReadStream(e, (er, s) => {
          if (er || !s) return reject(er);
          const chunks: Buffer[] = [];
          s.on("data", c => chunks.push(c)); s.on("error", reject);
          s.on("end", () => { out.set(e.fileName, Buffer.concat(chunks).toString("utf8")); zip.readEntry(); });
        });
      });
      zip.on("end", () => resolve(out)); zip.on("error", reject);
      zip.readEntry();
    });
  });
}

async function docxText(buf: Buffer): Promise<string> {
  const parts = await zipEntries(buf, n => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n));
  if (!parts.has("word/document.xml")) throw new Error("DOCX sem word/document.xml");
  const order = ["word/document.xml", ...[...parts.keys()].filter(k => k !== "word/document.xml").sort()];
  return order.map(k => xmlToText(parts.get(k)!)).filter(Boolean).join("\n\n");
}

async function odtText(buf: Buffer): Promise<string> {
  const parts = await zipEntries(buf, n => n === "content.xml");
  if (!parts.has("content.xml")) throw new Error("ODT sem content.xml");
  return xmlToText(parts.get("content.xml")!);
}

async function pdfText(buf: Buffer): Promise<{ text: string; pages: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // In Node pdfjs runs its "worker" in the same thread; loading it here (a
  // static path) makes the packaged server include the file.
  const g = globalThis as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
        if (typeof item.str !== "string") continue;
        line += item.str;
        if (item.hasEOL) { lines.push(line); line = ""; }
      }
      if (line) lines.push(line);
      pages.push(lines.join("\n").replace(/\f/g, " "));
      page.cleanup();
    }
    return { text: pages.join("\f"), pages: doc.numPages };
  } finally { await task.destroy(); }
}

export async function extractText(buf: Buffer, ext: string): Promise<Extracted> {
  try {
    if (ext === ".docx") return withText(await docxText(buf));
    if (ext === ".odt") return withText(await odtText(buf));
    if (TEXT_EXT.has(ext)) return withText(buf.toString("utf8"));
    if (ext === ".pdf") {
      const r = await pdfText(buf);
      const letters = r.text.replace(/[\s\f]/g, "").length;
      if (letters < 20 * Math.max(1, r.pages) / 4) return { status: "no_text", text: "", pages: r.pages, note: "PDF sem camada de texto (digitalização): precisa de OCR para ser pesquisado." };
      return { status: "indexed", text: r.text, pages: r.pages };
    }
    if (ext === ".doc") return { status: "unsupported", text: "", note: "Formato .doc (Word 97-2003) ainda não é lido; salve como .docx para pesquisar o conteúdo." };
    return { status: "unsupported", text: "", note: `Formato ${ext || "sem extensão"} não tem leitura de texto.` };
  } catch (e) {
    return { status: "error", text: "", note: `Não foi possível ler o texto: ${(e as Error).message}`.slice(0, 300) };
  }
}

function withText(text: string): Extracted {
  return text.trim() ? { status: "indexed", text: text.normalize("NFC") } : { status: "no_text", text: "", note: "Arquivo sem texto." };
}

type Row = { version_id: string; size: string; mtime_ms: number };

/** Indexes one working copy if it is new or changed since it was read. Returns true if it read the file. */
export async function indexVersion(v: { id: string; storageKey: string; originalName: string | null }, root: string, known?: Row): Promise<boolean> {
  let file: string;
  try { file = containedPath(root, v.storageKey, "file"); }
  catch (e) {
    if (e instanceof DesktopError) {
      await upsert(v.id, { status: "error", text: "", note: e.code === "link" ? "Caminho com link: não lido." : "Cópia de trabalho não encontrada na pasta atual." }, "", 0, 0);
      return true;
    }
    throw e;
  }
  const st = fs.statSync(file);
  if (known && Number(known.size) === st.size && known.mtime_ms === st.mtimeMs) return false;
  const ext = path.extname(v.originalName ?? file).toLowerCase();
  if (st.size > MAX_BYTES) { await upsert(v.id, { status: "unsupported", text: "", note: "Arquivo maior que 60 MB: conteúdo não indexado." }, "", st.size, st.mtimeMs); return true; }
  const { fd } = openContained(root, v.storageKey);
  let buf: Buffer;
  try { buf = fs.readFileSync(fd); } finally { fs.closeSync(fd); }
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  await upsert(v.id, await extractText(buf, ext), sha, st.size, st.mtimeMs);
  return true;
}

async function upsert(versionId: string, x: Extracted, sha: string, size: number, mtimeMs: number) {
  await prisma.$executeRaw`insert into desktop.document_text (version_id, sha256, size, mtime_ms, status, note, pages, content, folded)
    values (${versionId}, ${sha}, ${size}, ${mtimeMs}, ${x.status}, ${x.note ?? null}, ${x.pages ?? null}, ${x.text}, ${fold(x.text)})
    on conflict (version_id) do update set sha256 = excluded.sha256, size = excluded.size, mtime_ms = excluded.mtime_ms, status = excluded.status,
      note = excluded.note, pages = excluded.pages, content = excluded.content, folded = excluded.folded, indexed_at = now()`;
}

export type IndexState = { total: number; indexed: number; pending: number; noText: number; unsupported: number; errors: number; notSearched: { versionId: string; documentId: string; name: string; version: number; status: string; note: string | null }[] };

/**
 * Brings the index up to date for the given versions, within a time budget
 * (the rest stays "pending" and is reported as not searched).
 */
export async function refreshIndex(versionIds: string[], budgetMs = 2500): Promise<void> {
  if (!versionIds.length) return;
  const root = await documentsRoot();
  const versions = await prisma.documentVersion.findMany({ where: { id: { in: versionIds }, source: SOURCE, storageKey: { not: null } }, select: { id: true, storageKey: true, originalName: true } });
  const rows = await prisma.$queryRaw<Row[]>`select version_id, size::text as size, mtime_ms from desktop.document_text where version_id = any(${versionIds})`;
  const known = new Map(rows.map(r => [r.version_id, r]));
  const end = Date.now() + budgetMs;
  for (const v of versions) {
    if (Date.now() > end) break;
    try {
      const k = known.get(v.id);
      if (k) {
        // Cheap staleness check before reading.
        try {
          const st = fs.statSync(containedPath(root, v.storageKey!, "file"));
          if (Number(k.size) === st.size && k.mtime_ms === st.mtimeMs) continue;
        } catch { /* indexVersion records the problem */ }
      }
      await indexVersion({ id: v.id, storageKey: v.storageKey!, originalName: v.originalName }, root, k);
    } catch (e) { console.error("[desktop] índice:", (e as Error).message); }
  }
}

/** Index situation of the given versions (accessible ones), for honest reporting. */
export async function indexState(versionIds: string[]): Promise<IndexState> {
  const root = await documentsRoot();
  const versions = await prisma.documentVersion.findMany({ where: { id: { in: versionIds }, source: SOURCE }, select: { id: true, storageKey: true, version: true, documentId: true, document: { select: { name: true } } } });
  const rows = await prisma.$queryRaw<{ version_id: string; status: string; note: string | null; size: string; mtime_ms: number }[]>`
    select version_id, status, note, size::text as size, mtime_ms from desktop.document_text where version_id = any(${versionIds})`;
  const byId = new Map(rows.map(r => [r.version_id, r]));
  const s: IndexState = { total: versions.length, indexed: 0, pending: 0, noText: 0, unsupported: 0, errors: 0, notSearched: [] };
  for (const v of versions) {
    const r = byId.get(v.id);
    let status = r?.status ?? "pending";
    if (r && status === "indexed" && v.storageKey) {
      try { const st = fs.statSync(containedPath(root, v.storageKey, "file")); if (Number(r.size) !== st.size || r.mtime_ms !== st.mtimeMs) status = "pending"; }
      catch { status = "error"; }
    }
    if (status === "indexed") { s.indexed++; continue; }
    if (status === "pending") s.pending++; else if (status === "no_text") s.noText++; else if (status === "unsupported") s.unsupported++; else s.errors++;
    s.notSearched.push({ versionId: v.id, documentId: v.documentId, name: v.document.name, version: v.version, status, note: status === "pending" ? "Ainda não indexado (ou alterado depois da última leitura)." : r?.note ?? null });
  }
  return s;
}
