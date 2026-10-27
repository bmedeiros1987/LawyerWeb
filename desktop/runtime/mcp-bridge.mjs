#!/usr/bin/env node
// stdio <-> HTTP bridge for the LawyerMind read-only MCP endpoint. An AI client (e.g. Claude Desktop)
// starts this program; it forwards each JSON-RPC message to the LOCAL app with the user's access token.
//   LAWYERMIND_MCP_TOKEN       access token created in LawyerMind > Configurações (required)
//   LAWYERMIND_STATE_DIR       the app's data folder (where mcp-endpoint.json is written) (required)
// It only ever talks to http://127.0.0.1:<port>/api/desktop/mcp, never to another host, and prints
// nothing but protocol messages on stdout (diagnostics go to stderr, never the token).
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const token = process.env.LAWYERMIND_MCP_TOKEN ?? "";
const stateDir = process.env.LAWYERMIND_STATE_DIR ?? "";
const ENDPOINT = /^http:\/\/127\.0\.0\.1:\d{2,5}\/api\/desktop\/mcp$/;

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const fail = (id, code, message) => { if (id !== undefined && id !== null) send({ jsonrpc: "2.0", id, error: { code, message } }); };

function endpoint() {
  try {
    const { url } = JSON.parse(fs.readFileSync(path.join(stateDir, "mcp-endpoint.json"), "utf8"));
    return typeof url === "string" && ENDPOINT.test(url) ? url : null;
  } catch { return null; }
}

async function forward(line) {
  let message;
  try { message = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido." } }); }
  const id = message && typeof message === "object" ? message.id : undefined;
  if (!token || !stateDir) return fail(id, -32001, "Configure LAWYERMIND_MCP_TOKEN e LAWYERMIND_STATE_DIR.");
  const url = endpoint();
  if (!url) return fail(id, -32001, "Abra o LawyerMind: o aplicativo precisa estar aberto para responder.");
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: line, redirect: "error", signal: AbortSignal.timeout(90_000) });
    if (res.status === 202) return;
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = null; }
    if (body && body.jsonrpc === "2.0") return send(id !== undefined && body.id === null ? { ...body, id } : body);
    fail(id, -32603, `O LawyerMind respondeu com erro ${res.status}.`);
  } catch (e) {
    process.stderr.write(`mcp-bridge: ${e instanceof Error ? e.name : "erro"}\n`);
    fail(id, -32603, "Não foi possível falar com o LawyerMind. Ele está aberto?");
  }
}

let chain = Promise.resolve();
readline.createInterface({ input: process.stdin }).on("line", (line) => { if (line.trim()) chain = chain.then(() => forward(line)); }).on("close", () => chain.then(() => process.exit(0)));
