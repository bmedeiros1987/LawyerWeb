// Synthetic documents for the open-file safety tests. Every byte is fabricated here: no real document,
// no macro code, no executable payload, no external address that is ever contacted.
import yazl from "yazl";

const CT = (extra = "") => `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${extra}</Types>`;
const DOC = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Cláusula sintética.</w:t></w:r></w:p></w:body></w:document>`;
const ROOT_RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
export const rels = (inner: string) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;

export type Part = { name: string; data: Buffer | string };

export function zipOf(parts: Part[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const z = new yazl.ZipFile(); const chunks: Buffer[] = [];
    z.outputStream.on("data", (c: Buffer) => chunks.push(c)).on("end", () => resolve(Buffer.concat(chunks))).on("error", reject);
    for (const p of parts) z.addBuffer(Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data), p.name, { compress: true });
    z.end();
  });
}

export const docxParts = (over: { contentTypesExtra?: string; documentRels?: string; extra?: Part[]; skipDocument?: boolean } = {}): Part[] => [
  { name: "[Content_Types].xml", data: CT(over.contentTypesExtra) },
  { name: "_rels/.rels", data: ROOT_RELS },
  ...(over.skipDocument ? [] : [{ name: "word/document.xml", data: DOC }]),
  ...(over.documentRels ? [{ name: "word/_rels/document.xml.rels", data: over.documentRels }] : []),
  ...(over.extra ?? []),
];
export const validDocx = () => zipOf(docxParts());

/** Replaces bytes in every local header and central directory copy of a name (same length), to craft hostile names. */
export function renameEntry(zip: Buffer, from: string, to: string): Buffer {
  if (from.length !== to.length) throw new Error("same length required");
  let out = Buffer.from(zip), at = 0, n = 0;
  while ((at = out.indexOf(from, at)) >= 0) { out.write(to, at, "latin1"); at += to.length; n++; }
  if (n < 2) throw new Error("name not found in both headers");
  return out;
}

/** Sets the "encrypted" bit in all local and central headers. */
export function markEncrypted(zip: Buffer): Buffer {
  const out = Buffer.from(zip);
  for (let i = 0; i + 8 < out.length; i++) {
    if (out.readUInt32LE(i) === 0x04034b50) out.writeUInt16LE(out.readUInt16LE(i + 6) | 1, i + 6);
    if (out.readUInt32LE(i) === 0x02014b50) out.writeUInt16LE(out.readUInt16LE(i + 8) | 1, i + 8);
  }
  return out;
}

export const OLE_MAGIC = Buffer.from("D0CF11E0A1B11AE1", "hex");
const pdfBody = (extra = "") => `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R ${extra} >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`;
export const pdf = (extra = "", opts: { eof?: boolean } = {}) => Buffer.from(opts.eof === false ? pdfBody(extra).replace("%%EOF\n", "") : pdfBody(extra));
