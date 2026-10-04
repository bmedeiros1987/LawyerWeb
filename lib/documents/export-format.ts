import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Document, Footer, Header, Packer, PageNumber, Paragraph, TextRun } from "docx";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { MAX_DRAFT_TEXT } from "./draft-format";

export class ExportError extends Error { constructor(message: string, public status: number) { super(message); } }
export type SavedExport = { body: string; version: number; sha256: string };
let active = 0;
let fontBytes: Promise<Buffer> | undefined;
function validate(input: SavedExport) {
  if (!input.body.trim() || input.body.length > MAX_DRAFT_TEXT || !Number.isSafeInteger(input.version) || input.version < 1 || /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/u.test(input.body) || !input.body.isWellFormed()) throw new ExportError("Texto incompatível com a exportação. Revise os caracteres do documento.", 422);
  if (createHash("sha256").update(input.body, "utf8").digest("hex") !== input.sha256) throw new ExportError("A integridade da versão salva não pôde ser confirmada.", 409);
}
const label = (input: SavedExport) => `Versão ${input.version} · SHA-256 ${input.sha256.slice(0, 12)}`;

function linesOf(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  const chars = new Set(font.getCharacterSet());
  for (const char of text) if (char !== "\n" && char !== "\r" && char !== "\t" && !chars.has(char.codePointAt(0)!)) throw new ExportError("O PDF não suporta um dos caracteres deste texto. Use DOCX ou revise o texto.", 422);
  const graphemes = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });
  for (const paragraph of text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n")) {
    let line = "", used = 0;
    for (const word of paragraph.match(/\s+|\S+/gu) ?? []) {
      const wordWidth = font.widthOfTextAtSize(word, size);
      if (used + wordWidth <= width) { line += word; used += wordWidth; continue; }
      if (line) { lines.push(line); line = ""; used = 0; }
      if (wordWidth <= width) { line = word; used = wordWidth; continue; }
      for (const { segment } of graphemes.segment(word)) {
        const segmentWidth = font.widthOfTextAtSize(segment, size);
        if (used + segmentWidth > width && line) { lines.push(line); line = ""; used = 0; }
        line += segment; used += segmentWidth;
      }
    }
    lines.push(line);
  }
  return lines;
}

async function pdf(input: SavedExport) {
  const document = await PDFDocument.create(); document.registerFontkit(fontkit);
  fontBytes ??= readFile(join(process.cwd(), "public/fonts/Inter-Regular-static.ttf"));
  const font = await document.embedFont(await fontBytes, { subset: false });
  document.setTitle(`Documento — versão ${input.version}`); document.setCreator("LawyerMind"); document.setSubject(`SHA-256 do texto salvo: ${input.sha256}`);
  const width = 595.28, height = 841.89, margin = 56.7, size = 11, lineHeight = 16;
  const lines = linesOf(input.body, font, size, width - margin * 2);
  const perPage = 42, pageCount = Math.ceil(lines.length / perPage);
  if (pageCount > 250) throw new ExportError("Texto excede o limite de 250 páginas de PDF.", 422);
  for (let index = 0; index < pageCount; index++) {
    const page = document.addPage([width, height]);
    page.drawText(`Documento · versão ${input.version}`, { x: margin, y: height - 42, size: 9, font, color: rgb(.25, .3, .36) });
    for (const [row, line] of lines.slice(index * perPage, (index + 1) * perPage).entries()) {
      if (line) page.drawText(line, { x: margin, y: height - 80 - row * lineHeight, size, font, color: rgb(.08, .09, .12) });
    }
    page.drawText(`${label(input)} · ${index + 1}/${pageCount}`, { x: margin, y: 38, size: 8, font, color: rgb(.25, .3, .36) });
  }
  return document.save();
}

async function docx(input: SavedExport) {
  const document = new Document({ creator: "LawyerMind", title: `Documento — versão ${input.version}`, description: `SHA-256 do texto salvo: ${input.sha256}`,
    styles: { default: { document: { run: { font: "Arial", size: 22 }, paragraph: { spacing: { after: 120, line: 276 } } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: `Documento · versão ${input.version}`, size: 18, color: "404D5C" })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ text: `${label(input)} · `, size: 16 }), new TextRun({ children: [PageNumber.CURRENT, "/", PageNumber.TOTAL_PAGES], size: 16 })] })] }) },
      children: input.body.replace(/\r\n?/g, "\n").split("\n").map(text => new Paragraph({ children: [new TextRun(text)] })),
    }],
  });
  return Packer.toBuffer(document);
}

export async function exportSavedVersion(input: SavedExport, format: "pdf" | "docx") {
  validate(input);
  if (active >= 2) throw new ExportError("Exportação ocupada. Tente novamente em instantes.", 503);
  active++;
  try { return await (format === "pdf" ? pdf(input) : docx(input)); } finally { active--; }
}
