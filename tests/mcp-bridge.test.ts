import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const bridge = path.resolve("desktop/runtime/mcp-bridge.mjs");
const TOKEN = "lmcp_0123456789ab." + "S".repeat(43);
const cleanup: (() => void)[] = [];
afterEach(() => { for (const c of cleanup.splice(0)) c(); });

async function fakeApp(handler: (req: http.IncomingMessage, body: string) => { status: number; body?: unknown }) {
  const seen: { auth?: string; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let b = ""; req.on("data", d => (b += d)).on("end", () => {
      seen.push({ auth: req.headers.authorization, body: b });
      const r = handler(req, b); res.writeHead(r.status, { "Content-Type": "application/json" }); res.end(r.body === undefined ? "" : JSON.stringify(r.body));
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  cleanup.push(() => server.close());
  return { port: (server.address() as { port: number }).port, seen };
}

function run(env: Record<string, string>, lines: string[]) {
  return new Promise<{ out: string[]; err: string; code: number | null }>((resolve) => {
    const child = spawn(process.execPath, [bridge], { env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv });
    let out = "", err = "";
    child.stdout.on("data", d => (out += d)); child.stderr.on("data", d => (err += d));
    child.on("close", code => resolve({ out: out.split("\n").filter(Boolean), err, code }));
    child.stdin.end(lines.join("\n") + "\n");
  });
}
const stateDirWith = (endpoint: unknown) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-bridge-")); cleanup.push(() => fs.rmSync(d, { recursive: true, force: true })); if (endpoint !== null) fs.writeFileSync(path.join(d, "mcp-endpoint.json"), JSON.stringify(endpoint)); return d; };
const msg = (id: number | null, method: string) => JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method });

describe("ponte stdio do MCP", () => {
  it("encaminha cada mensagem com o token, na ordem, e devolve a resposta; notificações não geram saída", async () => {
    const app = await fakeApp((_req, b) => { const m = JSON.parse(b); return m.id === undefined ? { status: 202 } : { status: 200, body: { jsonrpc: "2.0", id: m.id, result: { eco: m.method } } }; });
    const dir = stateDirWith({ url: `http://127.0.0.1:${app.port}/api/desktop/mcp` });
    const r = await run({ LAWYERMIND_MCP_TOKEN: TOKEN, LAWYERMIND_STATE_DIR: dir }, [msg(1, "initialize"), msg(null, "notifications/initialized"), msg(2, "tools/list")]);
    expect(r.out.map(l => JSON.parse(l))).toEqual([{ jsonrpc: "2.0", id: 1, result: { eco: "initialize" } }, { jsonrpc: "2.0", id: 2, result: { eco: "tools/list" } }]);
    expect(app.seen.map(s => s.auth)).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
    expect(r.out.join("") + r.err).not.toContain(TOKEN);
  });

  it("só fala com 127.0.0.1: um endereço diferente no arquivo de endpoint é ignorado (e o token não sai)", async () => {
    const app = await fakeApp(() => ({ status: 200, body: { jsonrpc: "2.0", id: 1, result: {} } }));
    for (const url of ["http://evil.example:80/api/desktop/mcp", `http://localhost:${app.port}/api/desktop/mcp`, `http://127.0.0.1:${app.port}/outro`, `https://127.0.0.1:${app.port}/api/desktop/mcp`]) {
      const dir = stateDirWith({ url });
      const r = await run({ LAWYERMIND_MCP_TOKEN: TOKEN, LAWYERMIND_STATE_DIR: dir }, [msg(1, "ping")]);
      expect(JSON.parse(r.out[0]).error.message).toMatch(/Abra o LawyerMind/);
    }
    expect(app.seen).toHaveLength(0);
  });

  it("app fechado, sem arquivo ou sem configuração: erro claro com o id da pergunta, sem travar", async () => {
    const noFile = await run({ LAWYERMIND_MCP_TOKEN: TOKEN, LAWYERMIND_STATE_DIR: stateDirWith(null) }, [msg(7, "ping")]);
    expect(JSON.parse(noFile.out[0])).toMatchObject({ id: 7, error: { message: expect.stringMatching(/Abra o LawyerMind/) } });
    const dead = await run({ LAWYERMIND_MCP_TOKEN: TOKEN, LAWYERMIND_STATE_DIR: stateDirWith({ url: "http://127.0.0.1:65501/api/desktop/mcp" }) }, [msg(8, "ping")]);
    expect(JSON.parse(dead.out[0])).toMatchObject({ id: 8, error: { message: expect.stringMatching(/Não foi possível falar/) } });
    const noCfg = await run({}, [msg(9, "ping")]);
    expect(JSON.parse(noCfg.out[0])).toMatchObject({ id: 9, error: { message: expect.stringMatching(/Configure/) } });
  });

  it("recusa do app (401) chega ao cliente como erro do protocolo, e JSON inválido não derruba a ponte", async () => {
    const app = await fakeApp(() => ({ status: 401, body: { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Acesso não autorizado." } } }));
    const dir = stateDirWith({ url: `http://127.0.0.1:${app.port}/api/desktop/mcp` });
    const r = await run({ LAWYERMIND_MCP_TOKEN: TOKEN, LAWYERMIND_STATE_DIR: dir }, ["isto não é json", msg(3, "ping")]);
    expect(JSON.parse(r.out[0]).error.code).toBe(-32700);
    expect(JSON.parse(r.out[1])).toMatchObject({ id: 3, error: { code: -32001 } });
    expect(r.code).toBe(0);
  });
});
