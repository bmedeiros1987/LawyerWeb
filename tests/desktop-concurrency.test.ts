// Imports the real modules through Vitest. Only DB and scrypt are substituted;
// six complete imports copy disposable files through the real filesystem code.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({
  account: { user_id: "u", password_hash: "", recovery_hash: "", locked_until: null as Date | null },
  sessions: [] as string[], tail: Promise.resolve(), active: 0, max: 0,
  verifyHook: undefined as (() => Promise<void>) | undefined,
  hash: undefined as unknown as (pw: string, salt: Buffer) => Buffer,
  failDelete: false,
}));
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, default: { ...actual, scrypt: (
    pw: string, salt: Buffer, _length: number, _opts: unknown,
    cb: (err: Error | null, key?: Buffer) => void,
  ) => {
    (async () => { if (pw === "old-password-123") await h.verifyHook?.(); return h.hash(pw, salt); })()
      .then(key => cb(null, key), err => cb(err));
  } } };
});
vi.mock("@/lib/prisma", () => {
  const query = async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes("returning true as ok")) return [{ ok: true }]; // reserveAttempt: account not locked
    if (sql.includes("select user_id, recovery_hash")) return [{ user_id: "u", recovery_hash: h.account.recovery_hash }];
    if (sql.includes("select user_id")) return [{ ...h.account }];
    if (sql.includes("select password_hash as h")) return [{ h: h.account.password_hash }];
    if (sql.includes("select is_owner")) return [{ o: true }];
    throw Error(sql);
  };
  const execute = async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const sql = strings.join("?");
    if (sql.includes("set password_hash")) {
      if (sql.includes("recovery_hash =")) {
        if (h.account.recovery_hash !== v[3]) return 0;
        h.account.recovery_hash = String(v[1]);
      } else if (sql.includes("and password_hash =") && h.account.password_hash !== v[2]) return 0;
      h.account.password_hash = String(v[0]); return 1;
    }
    if (sql.includes("set failed_attempts = 0")) return 1;
    if (sql.includes("delete from desktop.local_session")) {
      if (!sql.includes("expires_at")) {
        if (h.failDelete) throw Error("injected session-delete failure");
        h.sessions = [];
      }
      return 1;
    }
    if (sql.includes("insert into desktop.local_session")) { h.sessions.push(String(v[0])); return 1; }
    throw Error(sql);
  };
  const prisma = {
    $queryRaw: query, $executeRaw: execute,
    legalDocument: { create: async () => ({ id: `doc-${crypto.randomUUID()}` }) },
    documentVersion: { create: async () => ({ id: `version-${crypto.randomUUID()}` }) },
    activityLog: { create: async () => ({}) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const previous = h.tail; let release!: () => void;
      h.tail = new Promise<void>(r => release = r); await previous;
      const account = { ...h.account }, sessions = [...h.sessions];
      try { return await fn(prisma); }
      catch (err) { h.account = account; h.sessions = sessions; throw err; }
      finally { release(); }
    },
  };
  return { prisma };
});
vi.mock("@/lib/desktop/db", () => {
  const pool = () => ({ connect: async () => {
    if (h.active === 6) throw Error("seventh connection requested: pool exhausted");
    h.active++; h.max = Math.max(h.max, h.active);
    return {
      query: async (sql: string) => ({ rows: sql.includes("pg_try") ? [{ ok: true }] : [] }),
      release: () => { h.active--; },
    };
  } });
  return { pool, withClient: async (fn: (c: unknown) => Promise<unknown>) => {
    const c = await pool().connect(); try { return await fn(c); } finally { c.release(); }
  } };
});
import { hashPassword, login, recoverOwner, changePassword, ownerResetPassword } from "@/lib/desktop/auth";
import { importDocument } from "@/lib/desktop/documents";

const reset = async () => {
  h.verifyHook = undefined; h.failDelete = false;
  h.account = { user_id: "u", password_hash: await hashPassword("old-password-123"), recovery_hash: crypto.createHash("sha256").update("KEY").digest("hex"), locked_until: null };
  h.sessions = ["existing"];
};

describe("desktop concurrency: real module imports with disposable files", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-module-test-"));
  const savedDesktop = process.env.MBLZ_DESKTOP, savedState = process.env.MBLZ_DESKTOP_STATE_DIR;
  beforeAll(() => {
    h.hash = (pw, salt) => crypto.createHash("sha512").update(pw).update(salt).digest();
    process.env.MBLZ_DESKTOP = "1"; process.env.MBLZ_DESKTOP_STATE_DIR = path.join(tmp, "state");
  });
  afterAll(() => {
    if (savedDesktop === undefined) delete process.env.MBLZ_DESKTOP; else process.env.MBLZ_DESKTOP = savedDesktop;
    if (savedState === undefined) delete process.env.MBLZ_DESKTOP_STATE_DIR; else process.env.MBLZ_DESKTOP_STATE_DIR = savedState;
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it("consumes one recovery key exactly once under concurrency", async () => {
    await reset();
    const results = await Promise.allSettled([
      recoverOwner("owner@test.invalid", "KEY", "new-password-123"),
      recoverOwner("owner@test.invalid", "KEY", "other-password-123"),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    expect(h.sessions).toEqual([]);
  });
  it.each(["recovery", "self-change", "owner-reset"])("rejects an old-password login in flight across %s", async mode => {
    await reset();
    let resume!: () => void, entered!: () => void;
    const waiting = new Promise<void>(r => entered = r), barrier = new Promise<void>(r => resume = r);
    let calls = 0;
    h.verifyHook = async () => { if (calls++ === 0) { entered(); await barrier; } };
    const inFlight = login("owner@test.invalid", "old-password-123");
    await waiting;
    if (mode === "recovery") await recoverOwner("owner@test.invalid", "KEY", "new-password-123");
    else if (mode === "self-change") await changePassword("u", "old-password-123", "new-password-123");
    else await ownerResetPassword("owner", "u", "new-password-123");
    resume();
    await expect(inFlight).rejects.toMatchObject({ status: 401 });
    expect(h.sessions).toEqual([]);
  });
  it("rolls back password and recovery rotation when session revocation fails", async () => {
    await reset(); const old = { ...h.account }; h.failDelete = true;
    await expect(recoverOwner("owner@test.invalid", "KEY", "new-password-123")).rejects.toThrow("injected");
    expect(h.account).toEqual(old); expect(h.sessions).toEqual(["existing"]);
    h.failDelete = false;
  });
  it("completes six imports with no seventh pool connection and preserves originals", async () => {
    const source = path.join(tmp, "original.txt"), content = "discardable synthetic document\n";
    fs.writeFileSync(source, content); fs.chmodSync(source, 0o444);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => importDocument({ userId: "u", workspaceId: `ws-${i}`, sourcePath: source })));
    expect(h.max).toBe(6); expect(h.active).toBe(0);
    expect(fs.readFileSync(source, "utf8")).toBe(content);
    for (const r of results) {
      expect(fs.readFileSync(path.join(tmp, "state", "documentos", r.storageKey), "utf8")).toBe(content);
      expect(r.sha256).toBe(crypto.createHash("sha256").update(content).digest("hex"));
    }
  });
});
