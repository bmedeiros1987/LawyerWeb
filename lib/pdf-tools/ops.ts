// Own PDF page tools (pdf-lib, MIT). Pure functions: bytes in, bytes out. They never touch
// the file system, the network, AI or MCP; callers decide where results are saved (always a
// new copy, never over the input).
import { PDFDocument, degrees } from "pdf-lib";

export const MAX_PDF_BYTES = 200 * 1024 ** 2;
export const MAX_PDF_PAGES = 5000;

export class PdfToolError extends Error {
  constructor(message: string, readonly code: "invalid" | "encrypted" | "limit" | "range" = "invalid") { super(message); }
}

/** "1-3,5,8-" → zero-based page indices, in the order written, without duplicates. */
export function parsePageSpec(spec: string, pageCount: number): number[] {
  const text = spec.replace(/\s+/g, "");
  if (!text) throw new PdfToolError("Informe as páginas (ex.: 1-3,5,8-).", "range");
  const seen = new Set<number>(); const out: number[] = [];
  for (const part of text.split(",")) {
    const m = /^(\d*)(?:-(\d*))?$/.exec(part);
    if (!part || !m || (m[1] === "" && m[2] === undefined) || (m[1] === "" && m[2] === "")) throw new PdfToolError(`Trecho inválido: "${part}".`, "range");
    const hasDash = part.includes("-");
    const from = m[1] === "" ? 1 : Number(m[1]);
    const to = !hasDash ? from : m[2] === "" ? pageCount : Number(m[2]);
    if (from < 1 || to < 1 || from > pageCount || to > pageCount) throw new PdfToolError(`O documento tem ${pageCount} página(s); "${part}" está fora do intervalo.`, "range");
    if (from > to) throw new PdfToolError(`Intervalo invertido: "${part}".`, "range");
    for (let p = from; p <= to; p++) if (!seen.has(p - 1)) { seen.add(p - 1); out.push(p - 1); }
  }
  return out;
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  if (bytes.byteLength > MAX_PDF_BYTES) throw new PdfToolError("PDF maior que 200 MB.", "limit");
  if (bytes.byteLength < 5 || Buffer.from(bytes.subarray(0, 1024)).indexOf("%PDF-") < 0) throw new PdfToolError("O arquivo não parece ser um PDF.");
  let doc: PDFDocument;
  try { doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false }); }
  catch (e) {
    if (/encrypt/i.test((e as Error).message)) throw new PdfToolError("O PDF está protegido por senha. Remova a proteção no programa de origem; o LawyerMind não quebra senhas.", "encrypted");
    throw new PdfToolError("Não foi possível ler o PDF (arquivo danificado ou fora do padrão).");
  }
  if (doc.getPageCount() > MAX_PDF_PAGES) throw new PdfToolError(`PDF com mais de ${MAX_PDF_PAGES} páginas.`, "limit");
  if (doc.getPageCount() === 0) throw new PdfToolError("O PDF não tem páginas.");
  return doc;
}

const save = (doc: PDFDocument) => doc.save({ useObjectStreams: false, updateFieldAppearances: false });

export async function pageCount(bytes: Uint8Array) { return (await load(bytes)).getPageCount(); }

export async function rotatePages(bytes: Uint8Array, spec: string, angle: 90 | 180 | 270) {
  const doc = await load(bytes);
  for (const i of parsePageSpec(spec, doc.getPageCount())) {
    const page = doc.getPage(i);
    page.setRotation(degrees((page.getRotation().angle + angle) % 360));
  }
  return save(doc);
}

export async function deletePages(bytes: Uint8Array, spec: string) {
  const doc = await load(bytes);
  const drop = parsePageSpec(spec, doc.getPageCount());
  if (drop.length >= doc.getPageCount()) throw new PdfToolError("Não é possível remover todas as páginas.", "range");
  for (const i of [...drop].sort((a, b) => b - a)) doc.removePage(i);
  return save(doc);
}

/** Pages in the order written (also reorders: "3,1,2"). */
export async function extractPages(bytes: Uint8Array, spec: string) {
  const src = await load(bytes);
  const keep = parsePageSpec(spec, src.getPageCount());
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(src, keep)) out.addPage(page);
  return save(out);
}

export async function mergePdfs(inputs: Uint8Array[]) {
  if (inputs.length < 2) throw new PdfToolError("Escolha ao menos dois PDFs para juntar.", "range");
  const out = await PDFDocument.create();
  let total = 0;
  for (const bytes of inputs) {
    const src = await load(bytes);
    total += src.getPageCount();
    if (total > MAX_PDF_PAGES) throw new PdfToolError(`O resultado passaria de ${MAX_PDF_PAGES} páginas.`, "limit");
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
  }
  return save(out);
}

/** One output per range spec, e.g. ["1-3", "4-"] → two PDFs. */
export async function splitPdf(bytes: Uint8Array, specs: string[]) {
  if (!specs.length) throw new PdfToolError("Informe ao menos um intervalo.", "range");
  if (specs.length > 100) throw new PdfToolError("No máximo 100 partes por vez.", "limit");
  const src = await load(bytes);
  const outs: Uint8Array[] = [];
  for (const spec of specs) {
    const keep = parsePageSpec(spec, src.getPageCount());
    const out = await PDFDocument.create();
    for (const page of await out.copyPages(src, keep)) out.addPage(page);
    outs.push(await save(out));
  }
  return outs;
}
