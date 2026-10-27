// PDF page tools on working copies. The input is read from the working copy (never the
// original); the result is ALWAYS a new version or a new document, created through the same
// import path as any file (hash, provenance, audit, text index). Nothing is overwritten.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { DesktopError, desktopStateDir } from "./env";
import { DERIVED_DIR, importDocument, workingCopyPath } from "./documents";
import { openContained, safeName } from "./paths";
import { versionForMember, type DocumentsMember } from "./permissions";
import { MAX_PDF_BYTES, PdfToolError, deletePages, extractPages, mergePdfs, rotatePages, splitPdf } from "@/lib/pdf-tools/ops";

export type PdfToolRequest =
  | { tool: "rotate"; versionId: string; pages: string; angle: 90 | 180 | 270 }
  | { tool: "delete"; versionId: string; pages: string }
  | { tool: "extract"; versionId: string; pages: string }
  | { tool: "split"; versionId: string; ranges: string[] }
  | { tool: "merge"; versionIds: string[]; name?: string };

const OPERATION: Record<PdfToolRequest["tool"], string> = {
  rotate: "girar páginas", delete: "remover páginas", extract: "extrair/reordenar páginas", split: "dividir", merge: "juntar",
};

async function readWorkingCopy(versionId: string, workspaceId: string) {
  const { root, version } = await workingCopyPath(versionId, workspaceId);
  if (!/\.pdf$/i.test(version.originalName ?? version.storageKey ?? "")) throw new DesktopError("Esta ferramenta funciona só com arquivos PDF.", 400);
  const { fd } = openContained(root, version.storageKey!);
  try {
    const st = fs.fstatSync(fd);
    if (st.size > MAX_PDF_BYTES) throw new DesktopError("PDF maior que 200 MB.", 413);
    return { bytes: new Uint8Array(fs.readFileSync(fd)), version };
  } finally { fs.closeSync(fd); }
}

function stage(bytes: Uint8Array, fileName: string) {
  const dir = path.join(desktopStateDir(), DERIVED_DIR, crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, safeName(fileName));
  fs.writeFileSync(file, bytes, { flag: "wx" });
  return { file, dir };
}

const stem = (name: string | null) => (name ?? "documento").replace(/\.pdf$/i, "");

/** Runs one tool; needs documents.edit. Returns the created version(s). */
export async function runPdfTool(input: { userId: string; member: DocumentsMember; request: PdfToolRequest }) {
  const { userId, member, request } = input;
  const workspaceId = member.workspaceId;
  const ids = request.tool === "merge" ? request.versionIds : [request.versionId];
  if (new Set(ids).size !== ids.length) throw new DesktopError("Escolha versões diferentes.", 400);
  const versions = [];
  for (const id of ids) versions.push(await versionForMember(userId, member, id, true));
  const sources = [];
  for (const v of versions) sources.push(await readWorkingCopy(v.id, workspaceId));
  const first = versions[0];

  type Out = { bytes: Uint8Array; fileName: string; newDocument: boolean; name?: string };
  const outs: Out[] = [];
  try {
    const src = sources[0].bytes;
    switch (request.tool) {
      case "rotate": outs.push({ bytes: await rotatePages(src, request.pages, request.angle), fileName: `${stem(first.originalName)}-girado.pdf`, newDocument: false }); break;
      case "delete": outs.push({ bytes: await deletePages(src, request.pages), fileName: `${stem(first.originalName)}-sem-paginas.pdf`, newDocument: false }); break;
      case "extract": outs.push({ bytes: await extractPages(src, request.pages), fileName: `${stem(first.originalName)}-paginas.pdf`, newDocument: false }); break;
      case "split": (await splitPdf(src, request.ranges)).forEach((bytes, i) => outs.push({
        bytes, fileName: `${stem(first.originalName)}-parte-${i + 1}.pdf`, newDocument: true, name: `${first.document.name} (parte ${i + 1}: ${request.ranges[i].trim()})`,
      })); break;
      case "merge": outs.push({ bytes: await mergePdfs(sources.map(s => s.bytes)), fileName: `${safeName(request.name?.trim() || "documentos-juntados")}.pdf`, newDocument: true, name: request.name?.trim() || `${first.document.name} (juntado)` }); break;
    }
  } catch (e) {
    if (e instanceof PdfToolError) throw new DesktopError(e.message, e.code === "limit" ? 413 : 422, e.code);
    throw e;
  }

  const created = [];
  for (const out of outs) {
    const staged = stage(out.bytes, out.fileName);
    try {
      created.push(await importDocument({
        userId, workspaceId, sourcePath: staged.file,
        documentId: out.newDocument ? null : first.documentId,
        clientId: first.document.clientId, matterId: first.document.matterId, name: out.name, kind: first.document.kind,
        derived: { operation: OPERATION[request.tool], fromVersionIds: ids },
      }));
    } finally { fs.rmSync(staged.dir, { recursive: true, force: true }); }
  }
  return { created: created.map(c => ({ documentId: c.documentId, versionId: c.versionId, version: c.version, sha256: c.sha256, size: c.size })) };
}
