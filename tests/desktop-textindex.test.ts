import { describe, expect, it } from "vitest";
import { extractText, fold, xmlToText } from "@/lib/desktop/textindex";
import { docxBuffer, pdfBuffer } from "./helpers/fixtures";

describe("text extraction for content search", () => {
  it("folds accents and case without changing positions", () => {
    const s = "Cláusula 5ª — RESCISÃO e Ônus";
    expect(fold(s)).toBe("clausula 5a — rescisao e onus");
    expect(fold(s).length).toBe(s.length);
  });

  it("reads DOCX body and header, one line per paragraph", async () => {
    const r = await extractText(await docxBuffer(["CLÁUSULA 1 – DO OBJETO", "A Contratada prestará serviços & suporte."], "Contrato fictício"), ".docx");
    expect(r.status).toBe("indexed");
    expect(r.text).toContain("CLÁUSULA 1 – DO OBJETO\nA Contratada prestará serviços & suporte.");
    expect(r.text).toContain("Contrato fictício");
  });

  it("keeps tabs and line breaks from WordprocessingML", () => {
    expect(xmlToText("<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>")).toBe("a\tb\nc");
  });

  it("reads a PDF text layer page by page (form feed between pages)", async () => {
    const r = await extractText(pdfBuffer(["Pagina um: multa de dez por cento", "Pagina dois: foro da comarca"]), ".pdf");
    expect(r.status).toBe("indexed");
    expect(r.pages).toBe(2);
    expect(r.text.split("\f")[1]).toContain("foro da comarca");
  });

  it("marks a PDF without text (scan) as needing OCR, not as searched", async () => {
    const r = await extractText(pdfBuffer(["", ""]), ".pdf");
    expect(r.status).toBe("no_text");
    expect(r.note).toMatch(/OCR/);
  });

  it("does not pretend to read .doc or unknown formats; corrupt files are errors", async () => {
    expect((await extractText(Buffer.from("x"), ".doc")).status).toBe("unsupported");
    expect((await extractText(Buffer.from("x"), ".xyz")).status).toBe("unsupported");
    expect((await extractText(Buffer.from("não é zip"), ".docx")).status).toBe("error");
  });
});
