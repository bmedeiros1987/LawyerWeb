// Synthetic DOCX and PDF files for tests (no real documents).
import yazl from "yazl";

export function docxBuffer(paragraphs: string[], header?: string): Promise<Buffer> {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = paragraphs.map(p => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join("");
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`), "[Content_Types].xml");
  zip.addBuffer(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`), "word/document.xml");
  if (header) zip.addBuffer(Buffer.from(`<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>${esc(header)}</w:t></w:r></w:p></w:hdr>`), "word/header1.xml");
  zip.end();
  return new Promise((res, rej) => { const c: Buffer[] = []; zip.outputStream.on("data", d => c.push(d)); zip.outputStream.on("end", () => res(Buffer.concat(c))); zip.outputStream.on("error", rej); });
}

/** A valid PDF with one text line per page (Helvetica, WinAnsi), or blank pages when `pages` contain "". */
export function pdfBuffer(pages: string[]): Buffer {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  pages.forEach((text, i) => {
    const esc = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${esc}) Tj ET` : "0 0 m 1 1 l S";
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n"; const offsets: number[] = [];
  for (let n = 1; n < objs.length; n++) { offsets[n] = Buffer.byteLength(out, "latin1"); out += `${n} 0 obj\n${objs[n]}\nendobj\n`; }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offsets.slice(1).map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
