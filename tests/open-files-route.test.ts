// Route contract with authorization and storage replaced by doubles; the files and safety gate are real.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ documentsMember: vi.fn(), assertMatterWritable: vi.fn(), importDocument: vi.fn(), matterFind: vi.fn() }));
vi.mock("@/lib/desktop/access", () => ({ documentsMember: m.documentsMember, assertMatterWritable: m.assertMatterWritable }));
vi.mock("@/lib/desktop/documents", () => ({ importDocument: m.importDocument }));
vi.mock("@/lib/prisma", () => ({ prisma: { matter: { findFirst: m.matterFind } } }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/workspace/context", () => ({ getActiveMembership: vi.fn() }));
import { POST } from "@/app/api/desktop/open-files/route";
import { DesktopError } from "@/lib/desktop/env";
import { docxParts, pdf, zipOf } from "./helpers/open-fixtures";

let dir: string, docx: string, macro: string, bytes: Buffer;
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const post = (body: unknown, origin = "http://127.0.0.1:3000") => POST(new Request("http://127.0.0.1:3000/api/desktop/open-files", { method: "POST", headers: { host: "127.0.0.1:3000", origin, "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-open-route-"));
  bytes = await zipOf(docxParts()); docx = path.join(dir, "contrato.docx"); fs.writeFileSync(docx, bytes);
  macro = path.join(dir, "macro.docx"); fs.writeFileSync(macro, await zipOf(docxParts({ extra: [{ name: "word/vbaProject.bin", data: "x" }] })));
  fs.writeFileSync(path.join(dir, "a.pdf"), pdf());
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  vi.stubEnv("MBLZ_DESKTOP", "1");
  for (const f of Object.values(m)) f.mockReset();
  m.documentsMember.mockResolvedValue({ userId: "u1", member: { workspaceId: "w1" } });
  m.importDocument.mockResolvedValue({ documentId: "d1", versionId: "v1" });
});

describe("/api/desktop/open-files", () => {
  it("is 404 outside the desktop app and requires documents.edit", async () => {
    vi.stubEnv("MBLZ_DESKTOP", "0");
    expect((await post({ action: "assess", paths: [docx] })).status).toBe(404);
    vi.stubEnv("MBLZ_DESKTOP", "1");
    m.documentsMember.mockRejectedValue(new DesktopError("Seu perfil não tem permissão para esta ação.", 403));
    expect((await post({ action: "assess", paths: [docx] })).status).toBe(403);
    expect(m.documentsMember).toHaveBeenCalledWith(true);
  });

  it("assess is read-only: it reports findings and imports nothing", async () => {
    const before = fs.statSync(docx).mtimeMs;
    const json = await (await post({ action: "assess", paths: [docx, macro, "/etc/../etc/passwd.pdf", path.join(dir, "old.doc")] })).json();
    expect(json.results.map((r: { ok: boolean }) => r.ok)).toEqual([true, false, false, false]);
    expect(json.results[0]).toMatchObject({ kind: "docx", sha256: sha(bytes) });
    expect(json.results[1].findings[0].code).toBe("macros");
    expect(m.importDocument).not.toHaveBeenCalled();
    expect(fs.statSync(docx).mtimeMs).toBe(before);
  });

  it("import needs the explicit confirmation of the exact SHA-256 shown", async () => {
    expect((await post({ action: "import", path: docx, sha256: sha(bytes) })).status).toBe(400); // no confirm
    expect((await post({ action: "import", confirm: false, path: docx, sha256: sha(bytes) })).status).toBe(400);
    const stale = await post({ action: "import", confirm: true, path: docx, sha256: "0".repeat(64) });
    expect(stale.status).toBe(409); expect((await stale.json()).code).toBe("changed");
    expect(m.importDocument).not.toHaveBeenCalled();
  });

  it("import refuses a blocked file even with a matching hash, and a cross-origin request", async () => {
    const r = await post({ action: "import", confirm: true, path: macro, sha256: "0".repeat(64) });
    expect(r.status).toBe(422); expect((await r.json()).code).toBe("macros");
    expect((await post({ action: "import", confirm: true, path: docx, sha256: sha(bytes) }, "http://evil.test")).status).toBe(403);
    expect(m.importDocument).not.toHaveBeenCalled();
  });

  it("imports a COPY from the verified real path, leaving the original untouched", async () => {
    const before = { bytes: fs.readFileSync(docx), mtime: fs.statSync(docx).mtimeMs };
    const r = await post({ action: "import", confirm: true, path: docx, sha256: sha(bytes), name: "Contrato fictício" });
    expect(r.status).toBe(201);
    expect(m.importDocument).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", workspaceId: "w1", sourcePath: fs.realpathSync(docx), documentId: null, name: "Contrato fictício" }));
    expect(fs.readFileSync(docx)).toEqual(before.bytes); expect(fs.statSync(docx).mtimeMs).toBe(before.mtime);
  });

  it("checks the matter permission before importing", async () => {
    m.assertMatterWritable.mockRejectedValue(new DesktopError("Processo não encontrado.", 404));
    const r = await post({ action: "import", confirm: true, path: docx, sha256: sha(bytes), matterId: "secret" });
    expect(r.status).toBe(404); expect(m.importDocument).not.toHaveBeenCalled();
  });
});
