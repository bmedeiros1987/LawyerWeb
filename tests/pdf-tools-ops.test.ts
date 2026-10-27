import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { deletePages, extractPages, mergePdfs, pageCount, parsePageSpec, PdfToolError, rotatePages, splitPdf } from "@/lib/pdf-tools/ops";

async function makePdf(pages: number, label = "P") {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) doc.addPage([300, 200]).drawText(`${label}${i}`, { x: 20, y: 100, size: 20, font });
  return doc.save();
}
const sizes = async (b: Uint8Array) => (await PDFDocument.load(b)).getPages().map(p => p.getWidth());

describe("parsePageSpec", () => {
  it("aceita páginas soltas, intervalos e intervalos abertos", () => {
    expect(parsePageSpec("1-3,5,8-", 9)).toEqual([0, 1, 2, 4, 7, 8]);
    expect(parsePageSpec("-2", 5)).toEqual([0, 1]);
    expect(parsePageSpec(" 3 , 1 ", 5)).toEqual([2, 0]);
  });
  it("remove duplicados e preserva a ordem escrita", () => { expect(parsePageSpec("3,1-3", 4)).toEqual([2, 0, 1]); });
  it.each(["", "0", "9", "3-1", "a", "1,,2", "-", "1-2-3"])("recusa %j", spec => {
    expect(() => parsePageSpec(spec, 5)).toThrow(PdfToolError);
  });
});

describe("operações", () => {
  it("gira só as páginas pedidas e acumula a rotação", async () => {
    const out = await rotatePages(await makePdf(3), "2", 90);
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map(p => p.getRotation().angle)).toEqual([0, 90, 0]);
    const again = await PDFDocument.load(await rotatePages(out, "2", 270));
    expect(again.getPage(1).getRotation().angle).toBe(0);
  });
  it("remove páginas e recusa remover todas", async () => {
    expect(await pageCount(await deletePages(await makePdf(5), "2,4"))).toBe(3);
    await expect(deletePages(await makePdf(2), "1-2")).rejects.toThrow(/todas as páginas/);
  });
  it("extrai e reordena", async () => {
    const src = await PDFDocument.create();
    for (const w of [100, 200, 300]) src.addPage([w, 50]);
    const out = await extractPages(await src.save(), "3,1");
    expect(await sizes(out)).toEqual([300, 100]);
  });
  it("junta na ordem dada e exige dois ou mais", async () => {
    expect(await pageCount(await mergePdfs([await makePdf(2), await makePdf(3)]))).toBe(5);
    await expect(mergePdfs([await makePdf(1)])).rejects.toThrow(PdfToolError);
  });
  it("divide em várias partes", async () => {
    const parts = await splitPdf(await makePdf(6), ["1-2", "3-"]);
    expect(await Promise.all(parts.map(pageCount))).toEqual([2, 4]);
  });
  it("não altera os bytes de entrada", async () => {
    const input = await makePdf(3); const copy = Uint8Array.from(input);
    await rotatePages(input, "1", 180); await deletePages(input, "1"); await extractPages(input, "1");
    expect(Buffer.compare(Buffer.from(input), Buffer.from(copy))).toBe(0);
  });
});

describe("entradas inválidas", () => {
  it("recusa arquivo que não é PDF", async () => { await expect(pageCount(new TextEncoder().encode("hello world"))).rejects.toThrow(/não parece ser um PDF/); });
  it("recusa PDF truncado sem travar", async () => {
    const pdf = await makePdf(2);
    await expect(pageCount(pdf.subarray(0, 60))).rejects.toBeInstanceOf(PdfToolError);
  });
  it("recusa PDF protegido por senha com mensagem clara", async () => {
    // Trailer mínimo com /Encrypt: basta para a detecção; não há senha a quebrar.
    const base = Buffer.from(await makePdf(1)).toString("latin1").replace("/Size", "/Encrypt << /Filter /Standard /V 1 /R 2 /O (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) /U (bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) /P -4 >> /Size");
    await expect(pageCount(Buffer.from(base, "latin1"))).rejects.toBeInstanceOf(PdfToolError);
  });
});
