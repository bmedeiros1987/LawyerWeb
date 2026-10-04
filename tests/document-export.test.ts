import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { exportSavedVersion } from "@/lib/documents/export-format";
const input = (body: string) => ({ body, version: 2, sha256: createHash("sha256").update(body).digest("hex") });
describe("saved document exports", () => {
  it("creates a real PDF with Portuguese glyphs, page wrapping and version provenance", async () => {
    const source = input("DOCUMENTO SINTÉTICO — SEM VALIDADE\n\nCláusula primeira: João e Marina.\nAção, obrigação, revisão e proteção.\n\n" + "Texto fictício para revisão. ".repeat(700));
    const bytes = await exportSavedVersion(source, "pdf"), pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1); expect(pdf.getTitle()).toContain("versão 2"); expect(pdf.getSubject()).toContain(source.sha256);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
    if (process.env.EXPORT_SAMPLE_DIR) { await mkdir(process.env.EXPORT_SAMPLE_DIR, { recursive: true }); await writeFile(`${process.env.EXPORT_SAMPLE_DIR}/synthetic-v2.pdf`, bytes); }
  });
  it("creates an editable OOXML archive with literal XML-like text", async () => {
    const bytes = await exportSavedVersion(input('DOCUMENTO SINTÉTICO — SEM VALIDADE\nJoão & Marina <contrato>\nCláusula: obrigação e revisão.\n\nFim.'), "docx");
    const archive = await JSZip.loadAsync(bytes);
    const xml = await archive.file("word/document.xml")!.async("string");
    expect(xml).toContain("João &amp; Marina &lt;contrato&gt;");
    expect(xml).toContain("Cláusula: obrigação e revisão.");
    expect(xml).not.toContain("<contrato>");
    expect(xml.match(/<w:p>/g)).toHaveLength(5);
    expect(await archive.file("word/footer1.xml")!.async("string")).toContain("SHA-256");
    expect(await archive.file("docProps/core.xml")!.async("string")).toContain("SHA-256 do texto salvo");
    if (process.env.EXPORT_SAMPLE_DIR) { await mkdir(process.env.EXPORT_SAMPLE_DIR, { recursive: true }); await writeFile(`${process.env.EXPORT_SAMPLE_DIR}/synthetic-v2.docx`, bytes); }
  });
  it("fails closed on changed hash, illegal XML, unsupported PDF glyphs or invalid versions", async () => {
    await expect(exportSavedVersion({ ...input("Synthetic"), body: "Changed" }, "pdf")).rejects.toMatchObject({ status: 409 });
    await expect(exportSavedVersion(input("Invalid\u0000text"), "docx")).rejects.toMatchObject({ status: 422 });
    await expect(exportSavedVersion(input("Unsupported 🦄"), "pdf")).rejects.toMatchObject({ status: 422 });
    await expect(exportSavedVersion({ ...input("Synthetic"), version: 0 }, "docx")).rejects.toMatchObject({ status: 422 });
  });
});
