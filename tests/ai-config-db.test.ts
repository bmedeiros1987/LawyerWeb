// Provider settings against a real PostgreSQL (throw-away database).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const RUN = process.env.RUN_DB_TESTS === "1";
const KEY = "sk-live-ABCDEFGH12345678";

describe.skipIf(!RUN)("configuração do provedor de IA", () => {
  const dbName = `lm_ai_test_${crypto.randomBytes(4).toString("hex")}`;
  const adminUrl = process.env.DATABASE_URL!;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ai-"));
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let m: any = {}; let direct: pg.Client;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect(); await admin.query(`create database ${dbName}`); await admin.end();
    const url = new URL(adminUrl); url.pathname = "/" + dbName;
    Object.assign(process.env, { DATABASE_URL: url.toString(), MBLZ_DESKTOP: "1", MBLZ_DESKTOP_STATE_DIR: path.join(tmp, "estado"), MBLZ_DESKTOP_MIGRATIONS_DIR: path.resolve("prisma/migrations"), AUTH_SECRET: "segredo-da-instalacao-0123456789" });
    fs.mkdirSync(path.join(tmp, "estado"), { recursive: true });
    m = { ...(await import("@/lib/desktop/migrate")), ...(await import("@/lib/desktop/db")), ...(await import("@/lib/ai/config")) };
    await m.runDesktopMigrations();
    direct = new pg.Client({ connectionString: url.toString() }); await direct.connect();
  }, 120_000);

  afterAll(async () => {
    await direct?.end(); await m.pool?.().end();
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect(); await admin.query(`drop database if exists ${dbName} with (force)`); await admin.end();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("sem configuração, a IA está indisponível e nada é enviado", async () => {
    expect((await m.aiProviderSummary()).configured).toBe(false);
    const s = (await m.currentProvider()).status();
    expect(s.state).toBe("unavailable");
    expect(s.sendsDataOutsideDevice).toBe(false);
  });

  it("guarda a chave cifrada, mostra só os 4 últimos caracteres e liga o provedor", async () => {
    const sum = await m.saveAiProvider({ kind: "anthropic", model: "meu-modelo", apiKey: KEY });
    expect(sum.keyHint).toBe("…5678");
    expect(JSON.stringify(sum)).not.toContain(KEY);
    const row = (await direct.query("select value from desktop.local_setting where key = 'ai_provider'")).rows[0].value as string;
    expect(row).not.toContain(KEY);
    expect((await m.currentProvider()).status().state).toBe("available");
  });

  it("mudar o endereço no banco torna a chave ilegível em vez de enviá-la a outro lugar", async () => {
    await m.saveAiProvider({ kind: "openai-compatible", model: "m", baseUrl: "https://api.exemplo.com/v1", apiKey: KEY });
    const row = JSON.parse((await direct.query("select value from desktop.local_setting where key = 'ai_provider'")).rows[0].value);
    row.config.baseUrl = "https://atacante.example/v1";
    await direct.query("update desktop.local_setting set value = $1 where key = 'ai_provider'", [JSON.stringify(row)]);
    const p = await m.currentProvider();
    expect(p.status().state).toBe("unavailable");
    expect(p.status().id).toBe("byok-unreadable");
    expect((await m.aiProviderSummary()).readable).toBe(false);
  });

  it("trocar o segredo da instalação também torna a chave ilegível; remover volta ao estado desligado", async () => {
    await m.saveAiProvider({ kind: "anthropic", model: "m", apiKey: KEY });
    const old = process.env.AUTH_SECRET; process.env.AUTH_SECRET = "outro-segredo-0123456789-xyz";
    expect((await m.currentProvider()).status().id).toBe("byok-unreadable");
    process.env.AUTH_SECRET = old;
    expect((await m.currentProvider()).status().state).toBe("available");
    await m.clearAiProvider();
    expect((await m.currentProvider()).status().state).toBe("unavailable");
  });

  it("recusa configuração inválida sem gravar nada", async () => {
    await expect(m.saveAiProvider({ kind: "openai-compatible", model: "m", baseUrl: "http://publico.example/v1", apiKey: KEY })).rejects.toThrow();
    expect((await m.aiProviderSummary()).configured).toBe(false);
  });
});
