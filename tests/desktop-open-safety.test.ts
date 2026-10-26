// Synthetic fixtures for the "open with LawyerMind" safety gate: malformed files, ZIP bombs, hostile paths,
// symlinks, FIFOs, macros and active PDF content. Nothing is executed, rendered, fetched or sent anywhere.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OPEN_LIMITS, assessOpenCandidate, lexicalCheck } from "@/lib/desktop/open-safety";
import { OLE_MAGIC, docxParts, markEncrypted, pdf, rels, renameEntry, validDocx, zipOf } from "./helpers/open-fixtures";

let dir: string;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-open-")); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const put = (name: string, data: Buffer | string) => { const f = path.join(dir, name); fs.writeFileSync(f, data); return f; };
const codes = (a: { findings: { code: string }[] }) => a.findings.map(f => f.code);
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

describe("lexical rules", () => {
  it.each([
    ["", "empty"], ["relative/a.pdf", "not-absolute"], ["/a/../b.pdf", "parent-segment"], ["/a/b\0.pdf", "control-chars"], ["/a/b\n.pdf", "control-chars"],
    ["/a/b.exe", "extension"], ["/a/b.docm", "extension"], ["/a/b", "extension"], ["/a/old.doc", "legacy-doc"], ["/a/old.DOC", "legacy-doc"],
  ])("posix: %j → %s", (input, code) => expect(lexicalCheck(input, "linux")?.code).toBe(code));

  it("posix: a path over 4096 characters → too-long", () => expect(lexicalCheck("/a/" + "x".repeat(5000) + ".pdf", "linux")?.code).toBe("too-long"));

  it.each([
    [String.raw`C:\Users\a\Contrato.docx`, null], [String.raw`C:/Users/a/x.pdf`, null],
    [String.raw`\\srv\share\x.pdf`, "network-path"], ["//srv/share/x.pdf", "network-path"], [String.raw`\\?\C:\x.pdf`, "device-path"], [String.raw`\\.\pipe\x.pdf`, "device-path"],
    [String.raw`C:\x\a.pdf:Zone.Identifier`, "stream-suffix"], [String.raw`C:\x\CON.pdf`, "reserved-name"], [String.raw`C:\x\lpt1.docx`, "reserved-name"],
    [String.raw`C:\x\a.pdf.`, "trailing-dot-space"], [String.raw`C:\x\..\a.pdf`, "parent-segment"], ["/posix/style.pdf", "not-absolute"], [String.raw`C:\x\old.doc`, "legacy-doc"],
  ])("windows: %j → %s", (input, code) => expect(lexicalCheck(input, "win32")?.code ?? null).toBe(code));

  it("accepts ordinary PDF and DOCX paths, with accents and spaces", () => {
    expect(lexicalCheck("/Users/a/Petição inicial.PDF", "darwin")).toBeNull();
    expect(lexicalCheck("/home/a/contrato (v2).docx", "linux")).toBeNull();
  });
});

describe("files on disk", () => {
  it("accepts a valid DOCX and returns the SHA-256 of the exact bytes without changing the original", async () => {
    const bytes = await validDocx(), f = put("ok.docx", bytes), before = fs.statSync(f);
    const a = await assessOpenCandidate(f);
    expect(a).toMatchObject({ ok: true, kind: "docx", size: bytes.length, sha256: sha(bytes) });
    expect(a.findings.filter(x => x.severity === "block")).toEqual([]);
    expect(fs.readFileSync(f)).toEqual(bytes);
    expect(fs.statSync(f).mtimeMs).toBe(before.mtimeMs); // read-only: not even touched
  });

  it("accepts a plain PDF (with the honest scan note) and reports active content as warnings only", async () => {
    const clean = await assessOpenCandidate(put("ok.pdf", pdf()));
    expect(clean.ok).toBe(true); expect(codes(clean)).toEqual(["scan-note"]);
    const active = await assessOpenCandidate(put("active.pdf", pdf("/OpenAction << /S /JavaScript /JS (app.alert) >> /Names << /EmbeddedFile 3 0 R >> /Next << /S /Launch >>")));
    expect(active.ok).toBe(true);
    expect(codes(active)).toEqual(expect.arrayContaining(["pdf-javascript", "pdf-launch", "pdf-auto-action", "pdf-embedded-file"]));
    expect(active.findings.every(f => f.severity === "warn")).toBe(true);
  });

  it("does not mistake look-alike names for active content", async () => {
    expect(codes(await assessOpenCandidate(put("lookalike.pdf", pdf("/JSON 1 /Launcher 2 /AAA 3"))))).toEqual(["scan-note"]);
  });

  it("flags a PDF without an end marker and refuses a wrong header or a renamed legacy file", async () => {
    expect(codes(await assessOpenCandidate(put("cut.pdf", pdf("", { eof: false }))))).toContain("pdf-truncated");
    expect(codes(await assessOpenCandidate(put("fake.pdf", "isto não é um pdf")))).toEqual(["type-mismatch"]);
    expect(codes(await assessOpenCandidate(put("old.docx", Buffer.concat([OLE_MAGIC, Buffer.alloc(600)]))))).toEqual(["type-mismatch"]);
    expect(codes(await assessOpenCandidate(put("old.pdf", Buffer.concat([OLE_MAGIC, Buffer.alloc(600)]))))).toEqual(["type-mismatch"]);
  });

  describe("malformed and hostile DOCX", () => {
    it("truncated ZIP (no central directory)", async () => {
      const z = await validDocx();
      expect(codes(await assessOpenCandidate(put("trunc.docx", z.subarray(0, z.length - 40))))).toEqual(["malformed"]);
    });
    it("ZIP signature followed by noise", async () => {
      expect(codes(await assessOpenCandidate(put("noise.docx", Buffer.concat([Buffer.from("PK\x03\x04"), crypto.randomBytes(2000)]))))).toEqual(["malformed"]);
    });
    it("a ZIP that is not a Word document", async () => {
      expect(codes(await assessOpenCandidate(put("other.docx", await zipOf([{ name: "readme.txt", data: "olá" }]))))).toContain("not-docx");
      expect(codes(await assessOpenCandidate(put("nodoc.docx", await zipOf(docxParts({ skipDocument: true })))))).toContain("not-docx");
    });
    it.each([["parent traversal", "xx/evil.xml", "../evil.xml"], ["absolute name", "xxxevil.xml", "/etc/ev.xml"], ["backslash traversal", "xx/evil.xml", "..\\evil.xml"]])("entry name: %s", async (_n, from, to) => {
      const z = await zipOf(docxParts({ extra: [{ name: from, data: "x" }] }));
      expect(codes(await assessOpenCandidate(put("path.docx", renameEntry(z, from, to))))).toEqual(["malformed"]);
    });
    it("encrypted entries", async () => {
      expect(codes(await assessOpenCandidate(put("enc.docx", markEncrypted(await validDocx()))))).toEqual(["encrypted"]);
    });
    it("ZIP bomb: one highly compressible 12 MiB part", async () => {
      const z = await zipOf(docxParts({ extra: [{ name: "word/bomb.bin", data: Buffer.alloc(12 * 1024 ** 2) }] }));
      expect(z.length).toBeLessThan(100_000);
      const a = await assessOpenCandidate(put("bomb.docx", z));
      expect(a.ok).toBe(false); expect(codes(a)).toEqual(["zip-bomb"]); expect(a.sha256).toBeNull();
    });
    it("declared totals above the limits (lowered limits stand in for a 400 MiB archive)", async () => {
      const z = await zipOf(docxParts({ extra: [{ name: "word/a.bin", data: Buffer.alloc(300_000, 7) }, { name: "word/b.bin", data: Buffer.alloc(300_000, 9) }] }));
      const f = put("big.docx", z);
      expect(codes(await assessOpenCandidate(f, { limits: { ...OPEN_LIMITS, maxTotalUncompressed: 500_000 } }))).toEqual(["zip-bomb"]);
      expect(codes(await assessOpenCandidate(f, { limits: { ...OPEN_LIMITS, maxEntryBytes: 200_000 } }))).toEqual(["zip-bomb"]);
      expect(codes(await assessOpenCandidate(f, { limits: { ...OPEN_LIMITS, maxEntries: 3 } }))).toEqual(["too-many-entries"]);
      expect(codes(await assessOpenCandidate(f, { limits: { ...OPEN_LIMITS, bombTotalRatio: 1 } }))).toEqual(["zip-bomb"]);
      expect((await assessOpenCandidate(f)).ok).toBe(true);
    });
    it("macros (vbaProject.bin, .docm content type) are refused, never run", async () => {
      expect(codes(await assessOpenCandidate(put("macro1.docx", await zipOf(docxParts({ extra: [{ name: "word/vbaProject.bin", data: "sintético, sem código" }] })))))).toContain("macros");
      const ct = `<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>`;
      expect(codes(await assessOpenCandidate(put("macro2.docx", await zipOf(docxParts({ contentTypesExtra: ct })))))).toContain("macros");
    });
    it("ActiveX is refused", async () => {
      expect(codes(await assessOpenCandidate(put("ax.docx", await zipOf(docxParts({ extra: [{ name: "word/activeX/activeX1.xml", data: "<x/>" }] })))))).toContain("activex");
    });
    it("external references are reported but never fetched; hyperlinks are ordinary", async () => {
      const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
      const hostile = rels(`<Relationship Id="r1" Type="${R}/attachedTemplate" Target="http://evil.invalid/t.dotm" TargetMode="External"/><Relationship Id="r2" Type="${R}/image" Target="http://evil.invalid/p.png" TargetMode="External"/>`);
      const a = await assessOpenCandidate(put("ext.docx", await zipOf(docxParts({ documentRels: hostile }))));
      expect(a.ok).toBe(true); expect(a.findings.find(f => f.code === "external-content")?.message).toMatch(/2 recurso/);
      const links = rels(`<Relationship Id="r1" Type="${R}/hyperlink" Target="https://exemplo.invalid/" TargetMode="External"/>`);
      expect(codes(await assessOpenCandidate(put("link.docx", await zipOf(docxParts({ documentRels: links })))))).toEqual([]);
    });
    it("embedded objects are only a warning", async () => {
      const a = await assessOpenCandidate(put("emb.docx", await zipOf(docxParts({ extra: [{ name: "word/embeddings/oleObject1.bin", data: "x" }] }))));
      expect(a.ok).toBe(true); expect(codes(a)).toContain("embedded-objects");
    });
  });

  describe("links and special files", () => {
    it("a symbolic link to a valid DOCX is refused (final component)", async () => {
      const real = put("real.docx", await validDocx()), link = path.join(dir, "atalho.docx");
      fs.symlinkSync(real, link);
      expect(codes(await assessOpenCandidate(link))).toEqual(["symlink"]);
    });
    it("a symbolic link named .pdf that points at a system file is refused and the target is not read", async () => {
      const link = path.join(dir, "passwd.pdf"); fs.symlinkSync("/etc/passwd", link);
      const a = await assessOpenCandidate(link);
      expect(codes(a)).toEqual(["symlink"]); expect(a.sha256).toBeNull(); expect(a.size).toBe(0);
    });
    it("a dangling link, a folder named .pdf and a missing file are refused without throwing", async () => {
      const dangling = path.join(dir, "dangling.pdf"); fs.symlinkSync(path.join(dir, "nao-existe"), dangling);
      expect(codes(await assessOpenCandidate(dangling))).toEqual(["symlink"]);
      fs.mkdirSync(path.join(dir, "pasta.pdf"));
      expect(codes(await assessOpenCandidate(path.join(dir, "pasta.pdf")))).toEqual(["not-regular"]);
      expect(codes(await assessOpenCandidate(path.join(dir, "ausente.pdf")))).toEqual(["unreadable"]);
    });
    it.skipIf(process.platform === "win32")("a FIFO named .pdf is refused immediately instead of blocking", async () => {
      const fifo = path.join(dir, "fila.pdf"); execFileSync("mkfifo", [fifo]);
      const started = Date.now();
      expect(codes(await assessOpenCandidate(fifo))).toEqual(["not-regular"]);
      expect(Date.now() - started).toBeLessThan(2000);
    });
    it("a file reached through a linked FOLDER is read at its real location", async () => {
      const sub = path.join(dir, "real-dir"); fs.mkdirSync(sub); fs.writeFileSync(path.join(sub, "a.pdf"), pdf());
      const linkDir = path.join(dir, "dir-link"); fs.symlinkSync(sub, linkDir);
      const a = await assessOpenCandidate(path.join(linkDir, "a.pdf"));
      expect(a.ok).toBe(true); expect(a.path).toBe(path.join(fs.realpathSync(sub), "a.pdf"));
    });
    it("empty and oversized files are refused", async () => {
      expect(codes(await assessOpenCandidate(put("vazio.pdf", "")))).toEqual(["empty"]);
      expect(codes(await assessOpenCandidate(put("grande.pdf", pdf()), { limits: { ...OPEN_LIMITS, maxFileBytes: 10 } }))).toEqual(["too-large"]);
    });
  });
});
