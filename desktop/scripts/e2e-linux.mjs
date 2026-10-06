#!/usr/bin/env node
// GUI end-to-end test of the *installed* Linux app through WebDriver
// (tauri-driver + WebKitWebDriver), with synthetic data:
//   create       cadastra cliente e processo pela interface e encerra o app;
//   verify-warm  reabre (PostgreSQL ainda ativo após a queda) e confere os dados;
//   verify-cold  reabre depois de o banco ter sido parado e confere os dados.
// The clean shutdown on window close is checked by scripts/close-window-linux.py.
// Native file dialogs (documentos/backup) are not driven here; those flows are
// covered by the packaged `--self-test`.
//
// Usage (inside Xvfb, with tauri-driver running on :4444):
//   node scripts/e2e-linux.mjs /usr/bin/lawyermind <evidence-dir> create|verify-warm|verify-cold

import fs from "node:fs";
import path from "node:path";

const app = process.argv[2] ?? "/usr/bin/lawyermind";
const out = process.argv[3] ?? ".";
const W = "http://127.0.0.1:4444";
const stamp = Date.now().toString(36);
const CLIENT = `Escritório Sintético E2E ${stamp}`;
const MATTER = `Ação sintética E2E ${stamp}`;
const NUMBER = "0000002-34.2026.8.26.0100";
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function wd(method, url, body) {
  const r = await fetch(W + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url}: ${JSON.stringify(j).slice(0, 400)}`);
  return j.value;
}
const EL = "element-6066-11e4-a6e6-4a4b6e4f8b4b";

async function session() {
  const v = await wd("POST", "/session", { capabilities: { alwaysMatch: { "tauri:options": { application: app } } } });
  return v.sessionId;
}
async function waitFor(sid, fn, what, ms = 30000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`timeout: ${what} ${last ?? ""}`);
}
const bodyText = sid => wd("POST", `/session/${sid}/execute/sync`, { script: "return document.body.innerText", args: [] });
async function xpath(sid, xp) {
  const v = await wd("POST", `/session/${sid}/element`, { using: "xpath", value: xp });
  return v[EL] ?? v.ELEMENT ?? Object.values(v)[0];
}
async function css(sid, sel) {
  const v = await wd("POST", `/session/${sid}/element`, { using: "css selector", value: sel });
  return v[EL] ?? v.ELEMENT ?? Object.values(v)[0];
}
const click = (sid, el) => wd("POST", `/session/${sid}/element/${el}/click`, {});
const type = (sid, el, text) => wd("POST", `/session/${sid}/element/${el}/value`, { text });
async function shot(sid, name) {
  const b64 = await wd("GET", `/session/${sid}/screenshot`);
  fs.writeFileSync(path.join(out, name), Buffer.from(b64, "base64"));
  log("screenshot", name);
}
async function nav(sid, label) {
  await click(sid, await xpath(sid, `//aside//button[.//span[normalize-space()='${label}']]`));
}
async function ready(sid) {
  await waitFor(sid, async () => (await bodyText(sid)).includes("Banco local ativo"), "banco local ativo", 60000);
}
// PostgreSQL removes postmaster.pid on a clean shutdown.
const PIDFILE = path.join(process.env.HOME ?? "", ".local/share/br.mblz.lawyermind/pgdata/postmaster.pid");
const postgresRunning = () => fs.existsSync(PIDFILE);

const results = [];
const step = async (name, fn) => { try { await fn(); results.push({ name, ok: true }); log("OK", name); } catch (e) { results.push({ name, ok: false, error: String(e) }); log("FAIL", name, e); throw e; } };
const mode = process.argv[4] ?? "create";
const stateFile = path.join(out, "e2e-linux-data.json");

let sid;
try {
  if (mode === "create") {
    await step("abre o app instalado e o banco local fica ativo", async () => { sid = await session(); await ready(sid); await shot(sid, "e2e-1-inicio.png"); });

    await step("cadastra cliente pela interface", async () => {
      await nav(sid, "Clientes");
      await click(sid, await xpath(sid, "//button[contains(.,'Novo cliente')]"));
      await type(sid, await css(sid, "form input[name=name]"), CLIENT);
      await type(sid, await css(sid, "form input[name=cpf_cnpj]"), "123.456.789-09");
      await type(sid, await css(sid, "form input[name=email]"), "e2e@exemplo.invalid");
      await click(sid, await xpath(sid, "//button[normalize-space()='Cadastrar cliente']"));
      await waitFor(sid, async () => (await bodyText(sid)).includes("Salvar alterações") && (await bodyText(sid)).includes(CLIENT), "cliente salvo");
      await shot(sid, "e2e-2-cliente.png");
    });

    await step("cadastra processo vinculado ao cliente", async () => {
      await nav(sid, "Processos");
      await click(sid, await xpath(sid, "//button[contains(.,'Novo processo')]"));
      await click(sid, await xpath(sid, `//select[@name='client_id']/option[normalize-space()='${CLIENT}']`));
      await type(sid, await css(sid, "form input[name=number]"), NUMBER);
      await type(sid, await css(sid, "form input[name=title]"), MATTER);
      await click(sid, await xpath(sid, "//button[normalize-space()='Cadastrar processo']"));
      await waitFor(sid, async () => { const t = await bodyText(sid); return t.includes(MATTER) && t.includes("Salvar alterações"); }, "processo salvo");
      await shot(sid, "e2e-3-processo.png");
      fs.writeFileSync(stateFile, JSON.stringify({ client: CLIENT, matter: MATTER, number: NUMBER }));
    });

    // Ending the WebDriver session terminates the app process abruptly (like a crash).
    await step("encerra o processo do app abruptamente", async () => { await wd("DELETE", `/session/${sid}`); sid = null; });
  } else {
    const data = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const label = mode === "verify-cold" ? "reabre com o banco parado (partida a frio) e os dados persistiram" : "reabre após queda (banco ainda ativo) e os dados persistiram";
    await step(label, async () => {
      sid = await session(); await ready(sid);
      await nav(sid, "Clientes");
      await waitFor(sid, async () => (await bodyText(sid)).includes(data.client), "cliente após reinício");
      await nav(sid, "Processos");
      await waitFor(sid, async () => { const t = await bodyText(sid); return t.includes(data.matter) && t.includes(data.number); }, "processo após reinício");
      await shot(sid, `e2e-4-${mode}.png`);
    });
  }
} finally {
  if (sid) await wd("DELETE", `/session/${sid}`).catch(() => {});
  const file = path.join(out, `e2e-linux-${mode}.json`);
  fs.writeFileSync(file, JSON.stringify({ app, mode, postgres_pidfile_present_at_end: postgresRunning(), results, ok: results.length > 0 && results.every(r => r.ok) }, null, 2));
}
