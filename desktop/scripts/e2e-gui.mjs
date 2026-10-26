#!/usr/bin/env node
// GUI end-to-end test of the INSTALLED app through WebDriver (tauri-driver),
// synthetic data only. Works where tauri-driver is supported (Linux with
// WebKitWebDriver, Windows with msedgedriver; not macOS).
//   first   primeiro acesso: cria conta proprietária, workspace, cliente (e edita), processo (e edita);
//           confere que a página do servidor local tem os seletores nativos (IPC) e que a tela Computador abre.
//   reopen  reabre o app: login com a senha e confere os dados.
// Usage: node e2e-gui.mjs <app-binary> <evidence-dir> first|reopen
import fs from "node:fs";
import path from "node:path";

const [app, out, mode = "first"] = process.argv.slice(2);
const W = process.env.WEBDRIVER_URL ?? "http://127.0.0.1:4444";
const memoFile = path.join(out, "e2e-gui-memo.json");
const memo = fs.existsSync(memoFile) ? JSON.parse(fs.readFileSync(memoFile, "utf8")) : {};
const results = [];
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function wd(method, url, body) {
  const r = await fetch(W + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url}: ${JSON.stringify(j).slice(0, 300)}`);
  return j.value;
}
const el = v => v["element-6066-11e4-a6e6-4a4b6e4f8b4b"] ?? v.ELEMENT ?? Object.values(v)[0];
let sid;
// Elements may appear asynchronously (popovers, client navigation): retry for up to 15 s.
async function find(using, value) {
  const end = Date.now() + 15000; let last;
  while (Date.now() < end) {
    try { return el(await wd("POST", `/session/${sid}/element`, { using, value })); } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`elemento não encontrado: ${value} (${last})`);
}
const css = s => find("css selector", s);
const xp = s => find("xpath", s);
const click = async e => wd("POST", `/session/${sid}/element/${e}/click`, {});
const type = async (e, text) => wd("POST", `/session/${sid}/element/${e}/value`, { text });
const clear = async e => wd("POST", `/session/${sid}/element/${e}/clear`, {});
const exec = (script, args = []) => wd("POST", `/session/${sid}/execute/sync`, { script, args });
const execAsync = (script, args = []) => wd("POST", `/session/${sid}/execute/async`, { script, args });
const text = () => exec("return document.body ? document.body.innerText : ''");
const url = () => wd("GET", `/session/${sid}/url`);
async function waitFor(fn, what, ms = 60000) {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await new Promise(r => setTimeout(r, 400)); }
  throw new Error(`timeout: ${what} ${last ?? ""}`);
}
async function shot(name) { fs.writeFileSync(path.join(out, name), Buffer.from(await wd("GET", `/session/${sid}/screenshot`), "base64")); log("captura", name); }
async function step(name, fn) {
  try { await fn(); results.push({ name, ok: true }); log("OK", name); }
  catch (e) { results.push({ name, ok: false, error: String(e) }); log("FAIL", name, e); try { await shot(`falha-${results.length}.png`); } catch {} throw e; }
}
async function go(p) { const base = new URL(await url()); await wd("POST", `/session/${sid}/url`, { url: `${base.origin}${p}` }); }

try {
  sid = (await wd("POST", "/session", { capabilities: { alwaysMatch: { "tauri:options": { application: app } } } })).sessionId;
  await step("app abre, inicia banco + servidor locais e mostra o login", async () => {
    await waitFor(async () => /127\.0\.0\.1:\d+\/login/.test(await url()), "tela de login no servidor local", 120000);
    await waitFor(async () => /crie a conta|bem-vindo de volta/i.test(await text()), "formulário de login");
    await shot(`gui-${mode}-1-login.png`);
  });

  if (mode === "first") {
    memo.email = "titular.gui@exemplo.invalid";
    memo.password = "Senha-GUI-" + Math.random().toString(36).slice(2, 10) + "-x";
    fs.writeFileSync(memoFile, JSON.stringify(memo));
    await step("primeiro acesso: cria a conta proprietária pela interface", async () => {
      await type(await css("input[name=name]"), "Titular GUI Sintético");
      await type(await css("input[name=email]"), memo.email);
      await type(await css("input[name=password]"), memo.password);
      await type(await css("input[name=passwordConfirmation]"), memo.password);
      await click(await xp("//button[contains(.,'Criar conta e entrar')]"));
      const key = await waitFor(async () => { try { return await exec("const k=document.querySelector('[data-testid=recovery-key]');return k&&k.textContent"); } catch { return null; } }, "chave de recuperação");
      if (!/^[A-Z2-9]{5}(-[A-Z2-9]{5}){4}$/.test(key)) throw new Error("chave inválida: " + key);
      await shot("gui-first-2-chave.png");
      await click(await xp("//button[contains(.,'Anotei a chave')]"));
    });
    await step("cria o workspace", async () => {
      await waitFor(async () => /\/app\/setup/.test(await url()), "tela de workspace");
      await type(await css(".setup-form input"), "Escritório GUI Sintético");
      await click(await css(".setup-submit"));
      await waitFor(async () => /\/app$/.test(await url()) || /\/app\?/.test(await url()), "entrada no app", 60000);
      await shot("gui-first-3-inicio.png");
    });
    await step("cadastra e edita cliente", async () => {
      await go("/app/clientes");
      await click(await xp("//summary[contains(.,'Novo cliente')]"));
      await type(await css("details[open] input[name=name]"), "Cliente GUI Ltda");
      await click(await xp("//details[@open]//button[contains(.,'Cadastrar cliente')]"));
      await waitFor(async () => (await text()).includes("Cliente GUI Ltda"), "cliente na lista");
      await click(await xp("//a[contains(.,'Cliente GUI Ltda')]"));
      await waitFor(async () => /\/app\/clientes\/.+/.test(await url()), "ficha do cliente");
      await click(await xp("//summary[contains(.,'Editar')]"));
      const name = await css("details[open] input[name=name]");
      await clear(name);
      await type(name, "Cliente GUI Editado Ltda");
      await click(await xp("//details[@open]//button[contains(.,'Salvar alterações')]"));
      await waitFor(async () => (await text()).includes("Alterações salvas"), "cliente salvo");
      await go("/app/clientes");
      await waitFor(async () => { const t = await text(); return t.includes("Cliente GUI Editado Ltda") && !t.includes("Cliente GUI LtdaCliente"); }, "nome editado exato na lista");
      await shot("gui-first-4-cliente.png");
    });
    await step("cadastra e edita processo", async () => {
      await go("/app/processos");
      await click(await xp("//summary[contains(.,'Novo processo')]"));
      await type(await css("details[open] input[name=title]"), "Ação GUI sintética");
      await type(await css("details[open] input[name=number]"), "0000003-45.2026.8.26.0100");
      await click(await xp("//details[@open]//select[@name='clientId']/option[contains(.,'Cliente GUI Editado Ltda')]"));
      await click(await xp("//details[@open]//button[contains(.,'Cadastrar processo')]"));
      // The form opens the new matter's page after saving.
      await waitFor(async () => /\/app\/processos\/.+/.test(await url()) && (await text()).includes("Ação GUI sintética"), "ficha do processo criado");
      await click(await xp("//summary[contains(.,'Editar')]"));
      await type(await css("details[open] input[name=courtUnit]"), "2ª Vara Cível (fictícia)");
      await click(await xp("//details[@open]//button[contains(.,'Salvar alterações')]"));
      await waitFor(async () => (await text()).includes("2ª Vara Cível (fictícia)"), "processo editado");
      await shot("gui-first-5-processo.png");
    });
    await step("página do servidor local tem os seletores nativos (IPC Tauri) e a tela Computador abre", async () => {
      const ok = await execAsync("const done=arguments[arguments.length-1];const i=window.__TAURI__&&window.__TAURI__.core&&window.__TAURI__.core.invoke;if(!i)return done('sem IPC');i('startup_status').then(s=>done(s&&s.url?'ok':'sem url')).catch(e=>done('erro '+e));");
      if (ok !== "ok") throw new Error("IPC na página do servidor: " + ok);
      await go("/app/computador");
      await waitFor(async () => (await text()).includes("Onde estão os dados") && (await text()).includes("Contas deste computador"), "tela Computador");
      await shot("gui-first-6-computador.png");
      await go("/app/documentos");
      await waitFor(async () => (await text()).includes("Importar arquivo"), "importação na tela de documentos");
      await shot("gui-first-7-documentos.png");
    });
  } else {
    await step("reabre: login com a conta local e os dados persistiram", async () => {
      await type(await css("input[name=email]"), memo.email);
      await type(await css("input[name=password]"), memo.password);
      await click(await xp("//button[normalize-space()='Entrar']"));
      await waitFor(async () => /\/app/.test(await url()) && !/login/.test(await url()), "entrada no app");
      await go("/app/clientes");
      await waitFor(async () => (await text()).includes("Cliente GUI Editado Ltda"), "cliente após reabrir");
      await go("/app/processos");
      await waitFor(async () => (await text()).includes("Ação GUI sintética"), "processo após reabrir");
      await shot("gui-reopen-2-processos.png");
    });
  }
} finally {
  if (sid) await wd("DELETE", `/session/${sid}`).catch(() => {});
  fs.writeFileSync(path.join(out, `e2e-gui-${mode}.json`), JSON.stringify({ app, mode, platform: process.platform, results, ok: results.length > 0 && results.every(r => r.ok) }, null, 2));
}
process.exit(results.length && results.every(r => r.ok) ? 0 : 1);
