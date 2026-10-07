#!/usr/bin/env node
// LawyerMind desktop acceptance self-test (synthetic data only).
//
// Runs against the *packaged* local server started by the installed app
// (`lawyermind --self-test ...` starts PostgreSQL + Next.js from the install
// directory, then runs this script with the bundled Node). Two phases, run in
// two separate app launches so persistence across a full restart is real:
//   seed   – first-run login, workspace, cadastro/edição, documentos (originais
//            somente leitura, cópia de trabalho, exportação), isolamento, backup
//   verify – after restart: persistência, restauração, relocalização,
//            bloqueio de senha, recuperação da conta proprietária
// Env: LM_BASE_URL, LM_WORK, LM_STATE, LM_PHASE, LM_REPORT

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const BASE = process.env.LM_BASE_URL;
const WORK = process.env.LM_WORK;
const STATE = process.env.LM_STATE;
const PHASE = process.env.LM_PHASE ?? "seed";
const REPORT = process.env.LM_REPORT ?? path.join(WORK, `selftest-${PHASE}.json`);
const memoFile = path.join(WORK, "selftest-memo.json");
const memo = fs.existsSync(memoFile) ? JSON.parse(fs.readFileSync(memoFile, "utf8")) : {};
const saveMemo = () => fs.writeFileSync(memoFile, JSON.stringify(memo, null, 2));
const steps = [];
const sha = buf => crypto.createHash("sha256").update(buf).digest("hex");
const shaFile = f => sha(fs.readFileSync(f));

class Agent {
  constructor(name) { this.name = name; this.cookies = new Map(); }
  async req(method, url, body) {
    const headers = { origin: BASE };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const r = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";"); const i = kv.indexOf("=");
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (!v || /max-age=0/i.test(c)) this.cookies.delete(k); else this.cookies.set(k, v);
    }
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: r.status, json, text, location: r.headers.get("location") };
  }
  get(u) { return this.req("GET", u); }
  post(u, b = {}) { return this.req("POST", u, b); }
  patch(u, b) { return this.req("PATCH", u, b); }
}

function expect(cond, msg) { if (!cond) throw new Error(msg); }
async function step(id, name, fn) {
  try { const detail = await fn(); steps.push({ id, name, ok: true, detail: detail ?? "" }); console.log(`OK   ${id} ${name}`); }
  catch (e) { steps.push({ id, name, ok: false, detail: String(e?.message ?? e) }); console.log(`FAIL ${id} ${name}: ${e?.message ?? e}`); }
}
const passed = id => steps.find(s => s.id === id)?.ok;

const owner = new Agent("owner"), other = new Agent("other");
const drive = path.join(WORK, "Google Drive", "Meu Drive", "Clientes Sintéticos");
const docsDefault = () => path.join(STATE, "documentos");

async function login(agent, email, password) {
  const r = await agent.post("/api/desktop/auth/login", { email, password });
  expect(r.status === 200, `login ${email}: HTTP ${r.status} ${r.json?.error ?? ""}`);
}

async function seed() {
  memo.ownerEmail = "titular@exemplo.invalid";
  memo.ownerPassword = crypto.randomBytes(12).toString("base64url") + "Aa1!";
  memo.otherEmail = "colega@exemplo.invalid";
  memo.otherPassword = crypto.randomBytes(12).toString("base64url") + "Bb2!";

  await step("D01", "servidor local responde só em loopback e pede autenticação", async () => {
    const s = await owner.get("/api/desktop/status");
    expect(s.status === 200 && s.json.ready && s.json.hasAccounts === false, `status ${s.status} ${s.text.slice(0, 200)}`);
    const app = await owner.get("/app");
    expect(app.status === 307 && /\/login/.test(app.location ?? ""), `/app sem sessão deveria ir para /login (${app.status})`);
    const api = await owner.get("/api/clients");
    expect(api.status === 401, `/api/clients sem sessão: ${api.status}`);
    // fetch() drops custom Host headers, so use http.request (simulates DNS rebinding).
    const badStatus = await new Promise((res, rej) => {
      const u = new URL(BASE);
      const rq = http.request({ host: u.hostname, port: u.port, path: "/api/desktop/status", headers: { host: "attacker.example" } }, r => { r.resume(); res(r.statusCode); });
      rq.on("error", rej); rq.end();
    });
    expect(badStatus === 421, `Host externo deveria ser recusado (421), veio ${badStatus}`);
    const forged = await fetch(BASE + "/api/desktop/auth/login", { method: "POST", headers: { origin: "http://attacker.example", "content-type": "application/json" }, body: "{}" });
    expect(forged.status === 403, `Origin externa deveria ser recusada (403), veio ${forged.status}`);
    return `URL ${BASE}`;
  });

  await step("D21", "integrações externas (Google, Telegram, WhatsApp, OpenClaw, push) indisponíveis no desktop", async () => {
    for (const u of ["/api/auth/signin/google", "/api/integrations/openclaw", "/api/integrations/whatsapp", "/api/agent/chat", "/api/cron/deadline-safety", "/app/integrations"]) {
      const r = await owner.get(u);
      expect(r.status === 404, `${u} deveria estar bloqueado (veio ${r.status})`);
    }
  });

  await step("D02", "primeiro acesso cria a conta proprietária offline (sem Google, sem credencial fixa)", async () => {
    const r = await owner.post("/api/desktop/auth/setup", { name: "Titular Sintético", email: memo.ownerEmail, password: memo.ownerPassword, passwordConfirmation: memo.ownerPassword });
    expect(r.status === 201 && /^[A-Z2-9]{5}(-[A-Z2-9]{5}){4}$/.test(r.json?.recoveryKey ?? ""), `setup ${r.status} ${r.text.slice(0, 200)}`);
    memo.recoveryKey = r.json.recoveryKey; saveMemo();
    const again = await new Agent("x").post("/api/desktop/auth/setup", { name: "Intruso", email: "x@exemplo.invalid", password: "senha-de-teste-123", passwordConfirmation: "senha-de-teste-123" });
    expect(again.status === 409, `segunda conta proprietária deveria ser recusada (${again.status})`);
    const wrong = await new Agent("y").post("/api/desktop/auth/login", { email: memo.ownerEmail, password: "senha-errada-123456" });
    expect(wrong.status === 401, `senha errada: ${wrong.status}`);
    const short = await new Agent("z").post("/api/desktop/auth/setup", { name: "a", email: "a@b.cd", password: "curta", passwordConfirmation: "curta" });
    expect(short.status >= 400, "senha curta aceita");
    return "conta proprietária criada; chave de recuperação exibida uma vez";
  });

  await step("D03", "workspace criado e isolado por conta", async () => {
    const r = await owner.post("/api/workspaces", { name: "Escritório Sintético A" });
    expect(r.status === 201, `workspace ${r.status} ${r.text.slice(0, 200)}`);
    memo.workspaceA = r.json.workspace.id; saveMemo();
  });

  await step("D04", "cadastra cliente", async () => {
    const r = await owner.post("/api/clients", { name: "Cliente Sintético Ltda", type: "LEGAL_ENTITY", cpfCnpj: "12.345.678/0001-90", email: "contato@exemplo.invalid" });
    expect(r.status === 201, `cliente ${r.status} ${r.text.slice(0, 200)}`);
    memo.clientId = r.json.client.id; saveMemo();
  });

  await step("D05", "edita cliente", async () => {
    const r = await owner.patch(`/api/clients/${memo.clientId}`, { name: "Cliente Sintético Editado Ltda", phone: "+55 11 0000-0000", notes: "editado pelo autoteste" });
    expect(r.status === 200 && r.json.client.name === "Cliente Sintético Editado Ltda", `edição ${r.status} ${r.text.slice(0, 200)}`);
  });

  await step("D06", "cadastra processo vinculado ao cliente", async () => {
    const r = await owner.post("/api/matters", { clientId: memo.clientId, title: "Ação sintética de cobrança", number: "0000001-23.2026.8.26.0100" });
    expect(r.status === 201, `processo ${r.status} ${r.text.slice(0, 200)}`);
    memo.matterId = (r.json.matter ?? r.json).id; saveMemo();
  });

  await step("D07", "edita processo", async () => {
    const r = await owner.patch(`/api/matters/${memo.matterId}`, { title: "Ação sintética de cobrança (editada)", court: "TJSP (fictício)", courtUnit: "1ª Vara Cível" });
    expect(r.status === 200 && r.json.matter.title.endsWith("(editada)"), `edição ${r.status} ${r.text.slice(0, 200)}`);
  });

  await step("D08", "consulta cliente e processo pelas telas do app", async () => {
    const list = await owner.get("/app/clientes");
    expect(list.status === 200 && list.text.includes("Cliente Sintético Editado Ltda"), `lista de clientes ${list.status}`);
    const m = await owner.get(`/app/processos/${memo.matterId}`);
    expect(m.status === 200 && m.text.includes("(editada)"), `ficha do processo ${m.status}`);
    const api = await owner.get(`/api/matters/${memo.matterId}`);
    expect(api.status === 200 && api.json.matter.courtUnit === "1ª Vara Cível", "processo via API");
  });

  // ---- documents ---------------------------------------------------------
  fs.mkdirSync(drive, { recursive: true });
  const original = path.join(drive, "Petição inicial (original).docx");
  const originalBytes = Buffer.concat([Buffer.from("PK\u0003\u0004 documento sintético LawyerMind — nenhum dado real\n"), crypto.randomBytes(4096)]);
  fs.writeFileSync(original, originalBytes);
  fs.chmodSync(original, 0o444);
  const before = { sha: shaFile(original), stat: fs.statSync(original), listing: fs.readdirSync(drive).sort() };

  await step("D09", "importa documento do Drive como cópia de trabalho; original intacto", async () => {
    const r = await owner.post("/api/desktop/documents/import", { sourcePath: original, matterId: memo.matterId, name: "Petição inicial" });
    expect(r.status === 201, `import ${r.status} ${r.text.slice(0, 300)}`);
    Object.assign(memo, { documentId: r.json.documentId, versionId: r.json.versionId, storageKey: r.json.storageKey }); saveMemo();
    expect(r.json.originalInSyncFolder, "origem no Drive deveria ser identificada como sincronizada");
    const after = fs.statSync(original);
    expect(shaFile(original) === before.sha && after.size === before.stat.size && after.mtimeMs === before.stat.mtimeMs, "o original foi alterado");
    expect(JSON.stringify(fs.readdirSync(drive).sort()) === JSON.stringify(before.listing), "a pasta do Drive ganhou/perdeu arquivos");
    const copy = path.join(docsDefault(), ...r.json.storageKey.split("/"));
    expect(fs.existsSync(copy) && shaFile(copy) === before.sha, "cópia de trabalho ausente ou diferente");
    expect(!copy.startsWith(path.join(WORK, "Google Drive")), "cópia de trabalho dentro da pasta sincronizada");
    memo.copyPath = copy; saveMemo();
    return `cópia: ${copy}`;
  });

  await step("D10", "edição (autosave) acontece só na cópia de trabalho", async () => {
    fs.appendFileSync(memo.copyPath, "\nalteração feita no editor (salvamento automático)\n");
    memo.editedSha = shaFile(memo.copyPath); saveMemo();
    expect(shaFile(original) === before.sha, "o original mudou após editar a cópia");
    expect(fs.statSync(original).mtimeMs === before.stat.mtimeMs, "data do original mudou");
  });

  const exportDir = path.join(WORK, "exportados"); fs.mkdirSync(exportDir, { recursive: true });
  const exported = path.join(exportDir, "Petição inicial - exportada.docx");
  await step("D11", "exportar cria um novo arquivo no destino escolhido", async () => {
    const r = await owner.post(`/api/desktop/documents/versions/${memo.versionId}/export`, { destPath: exported });
    expect(r.status === 200 && !r.json.replaced, `export ${r.status} ${r.text.slice(0, 200)}`);
    expect(shaFile(exported) === memo.editedSha, "conteúdo exportado difere da cópia de trabalho");
  });

  await step("D12", "sobrescrever exige confirmação específica", async () => {
    fs.writeFileSync(exported, "arquivo do usuário que não pode ser perdido");
    const userSha = shaFile(exported);
    const a = await owner.post(`/api/desktop/documents/versions/${memo.versionId}/export`, { destPath: exported });
    expect(a.status === 409 && a.json.code === "exists" && shaFile(exported) === userSha, `sem overwrite: ${a.status}`);
    const b = await owner.post(`/api/desktop/documents/versions/${memo.versionId}/export`, { destPath: exported, overwrite: true, confirmation: "sim" });
    expect(b.status === 409 && b.json.code === "confirm" && shaFile(exported) === userSha, `confirmação errada: ${b.status}`);
    const c = await owner.post(`/api/desktop/documents/versions/${memo.versionId}/export`, { destPath: exported, overwrite: true, confirmation: "SOBRESCREVER" });
    expect(c.status === 200 && c.json.replaced && shaFile(exported) === memo.editedSha, `com SOBRESCREVER: ${c.status}`);
  });

  await step("D13", "exportação para pasta sincronizada é permitida com aviso", async () => {
    const dest = path.join(drive, "Petição exportada.docx");
    const r = await owner.post(`/api/desktop/documents/versions/${memo.versionId}/export`, { destPath: dest });
    expect(r.status === 200 && r.json.syncFolder, `export para Drive ${r.status} ${r.text.slice(0, 200)}`);
    expect(shaFile(original) === before.sha, "o original mudou");
    const inside = await owner.post(`/api/desktop/documents/versions/${memo.versionId}/export`, { destPath: path.join(docsDefault(), "x.docx") });
    expect(inside.status === 400, `export para dentro da pasta de cópias deveria ser recusado (${inside.status})`);
  });

  await step("D14", "pasta de cópias de trabalho em pasta sincronizada é recusada", async () => {
    const synced = path.join(WORK, "Dropbox", "LawyerMind"); fs.mkdirSync(synced, { recursive: true });
    const r = await owner.post("/api/desktop/storage/root", { path: synced, force: true });
    expect(r.status === 400 && r.json.code === "synced", `deveria recusar (${r.status} ${r.text.slice(0, 150)})`);
  });

  await step("D15", "nova versão por importação preserva a anterior", async () => {
    const v2 = path.join(drive, "Petição inicial v2.docx"); fs.writeFileSync(v2, "versão 2 sintética"); fs.chmodSync(v2, 0o444);
    const r = await owner.post("/api/desktop/documents/import", { sourcePath: v2, documentId: memo.documentId });
    expect(r.status === 201 && r.json.version === 2, `v2 ${r.status} ${r.text.slice(0, 200)}`);
    expect(fs.existsSync(memo.copyPath) && shaFile(memo.copyPath) === memo.editedSha, "versão 1 alterada");
    const page = await owner.get(`/app/documentos/${memo.documentId}`);
    expect(page.status === 200 && page.text.includes("Cópias de trabalho"), "tela do documento");
  });

  // ---- isolation ------------------------------------------------------------
  await step("D16", "segunda conta local criada só pela proprietária", async () => {
    const denied = await new Agent("anon").post("/api/desktop/accounts", { name: "x", email: "x@exemplo.invalid", password: "senha-de-teste-123" });
    expect(denied.status === 401, `sem sessão: ${denied.status}`);
    const r = await owner.post("/api/desktop/accounts", { name: "Colega Sintético", email: memo.otherEmail, password: memo.otherPassword });
    expect(r.status === 201, `conta ${r.status} ${r.text.slice(0, 200)}`);
    await login(other, memo.otherEmail, memo.otherPassword);
    const ws = await other.post("/api/workspaces", { name: "Escritório Sintético B" });
    expect(ws.status === 201, "workspace B");
    const c = await other.post("/api/clients", { name: "Cliente do Escritório B" });
    expect(c.status === 201, "cliente B");
    memo.clientB = c.json.client.id; saveMemo();
  });

  await step("D17", "isolamento: a outra conta não vê nem acessa dados do workspace A", async () => {
    const list = await other.get("/api/clients");
    expect(list.status === 200 && !JSON.stringify(list.json).includes("Sintético Editado"), "lista de clientes vazou");
    const page = await other.get(`/app/clientes/${memo.clientId}`);
    expect(page.status === 404, `ficha do cliente A: ${page.status}`);
    const m = await other.get(`/api/matters/${memo.matterId}`);
    expect(m.status === 404, `processo A via API: ${m.status}`);
    const edit = await other.patch(`/api/clients/${memo.clientId}`, { name: "invadido" });
    expect(edit.status === 404, `editar cliente A: ${edit.status}`);
    const doc = await other.post(`/api/desktop/documents/versions/${memo.versionId}/export`, { destPath: path.join(exportDir, "vazado.docx") });
    expect(doc.status === 404 && !fs.existsSync(path.join(exportDir, "vazado.docx")), `exportar documento A: ${doc.status}`);
    const imp = await other.post("/api/desktop/documents/import", { sourcePath: original, matterId: memo.matterId });
    expect(imp.status === 404, `importar para processo A: ${imp.status}`);
    const bk = await other.post("/api/desktop/backup", { dest: path.join(WORK, "nao.lawyermind-backup"), includeDocuments: true });
    expect(bk.status === 403, `backup por não proprietária: ${bk.status}`);
    const mineA = await owner.get("/api/clients");
    expect(!JSON.stringify(mineA.json).includes("Escritório B"), "A vê dados de B");
  });

  // ---- backup -----------------------------------------------------------------
  await step("D18", "backup consistente com documentos, verificado (pode ir para pasta sincronizada)", async () => {
    const dest = path.join(WORK, "Google Drive", "Meu Drive", "Backups", "lawyermind-teste");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const r = await owner.post("/api/desktop/backup", { dest, includeDocuments: true });
    expect(r.status === 201 && r.json.verified && r.json.includes_documents && r.json.documents === 2, `backup ${r.status} ${r.text.slice(0, 300)}`);
    expect(r.json.syncFolder, "deveria avisar pasta sincronizada");
    expect(!fs.existsSync(path.join(STATE, "pgdata", "backup_label")), "pasta viva do banco tocada");
    memo.backup = r.json.path; memo.backupCounts = r.json.counts; saveMemo();
    const v = await owner.post("/api/desktop/backup/verify", { path: memo.backup });
    expect(v.status === 200 && v.json.includes_documents, "verificação");
    return `${r.json.bytes} bytes; ${r.json.documents} cópias; ${JSON.stringify(r.json.counts["public.Client"])} clientes`;
  });

  await step("D19", "backup somente do banco declara que não inclui documentos", async () => {
    const r = await owner.post("/api/desktop/backup", { dest: path.join(WORK, "somente-banco"), includeDocuments: false });
    expect(r.status === 201 && !r.json.includes_documents && r.json.documents === 0, `backup ${r.status}`);
    const dup = await owner.post("/api/desktop/backup", { dest: path.join(WORK, "somente-banco"), includeDocuments: false });
    expect(dup.status === 409, "backup sobrescreveu arquivo existente");
  });

  await step("D20", "backup corrompido é rejeitado", async () => {
    const bad = path.join(WORK, "corrompido.lawyermind-backup");
    const buf = fs.readFileSync(memo.backup); buf[Math.floor(buf.length / 3)] ^= 0xff; fs.writeFileSync(bad, buf);
    const v = await owner.post("/api/desktop/backup/verify", { path: bad });
    expect(v.status >= 400, `backup corrompido aceito (${v.status})`);
  });

  await step("D22", "abrir para editar entrega a cópia de trabalho; abrir para leitura entrega cópia temporária somente leitura", async () => {
    const url = `/api/desktop/documents/versions/${memo.versionId}/open`;
    const edit = await owner.post(url, { mode: "edit" });
    expect(edit.status === 200 && edit.json.mode === "edit" && fs.realpathSync(edit.json.path) === fs.realpathSync(memo.copyPath), `editar: ${edit.status} ${edit.text.slice(0, 200)}`);
    const read = await owner.post(url, {});
    expect(read.status === 200 && read.json.mode === "read", `leitura (padrão): ${read.status} ${read.text.slice(0, 200)}`);
    expect(read.json.path.startsWith(path.join(STATE, "leitura")) && fs.realpathSync(read.json.path) !== fs.realpathSync(memo.copyPath), "leitura deveria usar cópia temporária");
    expect((fs.statSync(read.json.path).mode & 0o222) === 0, "cópia de leitura deveria ser somente leitura");
    expect(shaFile(read.json.path) === memo.editedSha && shaFile(memo.copyPath) === memo.editedSha, "conteúdo");
    const foreign = await other.post(url, { mode: "read" });
    expect(foreign.status === 404, `outra conta abrindo documento A: ${foreign.status}`);
  });

  await step("D23", "links simbólicos e junções que saem da pasta autorizada são recusados (abrir, exportar, backup, importar)", async () => {
    // Windows: junction (no privilege needed); macOS/Linux: symbolic link.
    const link = (target, at) => fs.symlinkSync(target, at, "junction");
    const unlink = at => { try { fs.unlinkSync(at); } catch { fs.rmdirSync(at); } };
    const fora = path.join(WORK, "fora-da-pasta"); fs.mkdirSync(fora, { recursive: true });
    const src = path.join(drive, "Procuração.pdf"); fs.writeFileSync(src, "procuração sintética"); fs.chmodSync(src, 0o444);
    const imp = await owner.post("/api/desktop/documents/import", { sourcePath: src, matterId: memo.matterId });
    expect(imp.status === 201, `import ${imp.status}`);
    const docDir = path.join(docsDefault(), ...path.dirname(imp.json.storageKey).split("/"));
    const moved = path.join(fora, "pasta-do-documento"); fs.renameSync(docDir, moved); link(moved, docDir);
    const results = [];
    try {
      const o = await owner.post(`/api/desktop/documents/versions/${imp.json.versionId}/open`, { mode: "edit" });
      const e = await owner.post(`/api/desktop/documents/versions/${imp.json.versionId}/export`, { destPath: path.join(WORK, "nao-exportar.pdf") });
      const b = await owner.post("/api/desktop/backup", { dest: path.join(WORK, "nao-gravar"), includeDocuments: true });
      results.push(o.status, e.status, b.status);
      expect(o.status === 422 && o.json.code === "link", `abrir via junção: ${o.status}`);
      expect(e.status === 422 && !fs.existsSync(path.join(WORK, "nao-exportar.pdf")), `exportar via junção: ${e.status}`);
      expect(b.status === 422 && !fs.readdirSync(WORK).some(f => f.startsWith("nao-gravar") || f.startsWith(".nao-gravar")), `backup via junção: ${b.status}`);
    } finally { unlink(docDir); fs.renameSync(moved, docDir); }
    const wsDir = path.join(docsDefault(), "ws", path.dirname(imp.json.storageKey).split("/")[1]);
    const wsMoved = path.join(fora, "ws"); fs.renameSync(wsDir, wsMoved); link(wsMoved, wsDir);
    try {
      const before = fs.readdirSync(wsMoved, { recursive: true }).length;
      const i = await owner.post("/api/desktop/documents/import", { sourcePath: src, matterId: memo.matterId });
      expect(i.status === 422 && fs.readdirSync(wsMoved, { recursive: true }).length === before, `importar via junção: ${i.status}`);
    } finally { unlink(wsDir); fs.renameSync(wsMoved, wsDir); }
    const alias = path.join(WORK, "atalho-documentos"); link(docsDefault(), alias);
    const ex = await owner.post(`/api/desktop/documents/versions/${memo.versionId}/export`, { destPath: path.join(alias, "dentro.docx") });
    expect(ex.status === 400 && !fs.existsSync(path.join(docsDefault(), "dentro.docx")), `exportar para atalho da pasta de cópias: ${ex.status}`);
    const ok = await owner.post(`/api/desktop/documents/versions/${imp.json.versionId}/open`, { mode: "edit" });
    expect(ok.status === 200, `após remover a junção o documento volta a abrir: ${ok.status}`);
    return `recusas: ${results.join(", ")}`;
  });
}

async function verify() {
  await step("P01", "após fechar e reabrir o app: login e sessão nova", async () => {
    const s = await owner.get("/api/desktop/status");
    expect(s.json?.hasAccounts === true, "contas não persistiram");
    await login(owner, memo.ownerEmail, memo.ownerPassword);
    await login(other, memo.otherEmail, memo.otherPassword);
  });
  await step("P02", "cliente e processo editados persistiram", async () => {
    const c = await owner.get("/api/clients");
    const client = c.json.clients.find(x => x.id === memo.clientId);
    expect(client?.name === "Cliente Sintético Editado Ltda" && client.notes === "editado pelo autoteste", "cliente");
    const m = await owner.get(`/api/matters/${memo.matterId}`);
    expect(m.json?.matter?.title.endsWith("(editada)") && m.json.matter.courtUnit === "1ª Vara Cível", "processo");
  });
  await step("P03", "documento e cópia de trabalho persistiram", async () => {
    const page = await owner.get(`/app/documentos/${memo.documentId}`);
    expect(page.status === 200 && page.text.includes("Petição inicial"), "documento");
    expect(fs.existsSync(memo.copyPath) && shaFile(memo.copyPath) === memo.editedSha, "cópia de trabalho");
  });
  await step("P04", "isolamento continua após reinício", async () => {
    const list = await other.get("/api/clients");
    expect(list.status === 200 && list.json.clients.some(x => x.id === memo.clientB) && !list.json.clients.some(x => x.id === memo.clientId), "isolamento");
  });

  await step("P05", "restauração: verifica, salva backup de segurança, não sobrescreve, desfaz alterações posteriores", async () => {
    const extra = await owner.post("/api/clients", { name: "Cliente criado depois do backup" });
    expect(extra.status === 201, "cliente extra");
    const conflict = path.join(WORK, "conflito");
    fs.mkdirSync(path.join(conflict, ...path.dirname(memo.storageKey).split("/")), { recursive: true });
    fs.writeFileSync(path.join(conflict, ...memo.storageKey.split("/")), "arquivo diferente");
    const refused = await owner.post("/api/desktop/backup/restore", { path: memo.backup, documentsTarget: conflict, confirmation: "RESTAURAR" });
    expect(refused.status === 409 && fs.readFileSync(path.join(conflict, ...memo.storageKey.split("/")), "utf8") === "arquivo diferente", `conflito: ${refused.status}`);
    const noConfirm = await owner.post("/api/desktop/backup/restore", { path: memo.backup, documentsTarget: path.join(WORK, "restaurado"), confirmation: "sim" });
    expect(noConfirm.status === 400, "restauração sem confirmação");
    const r = await owner.post("/api/desktop/backup/restore", { path: memo.backup, documentsTarget: path.join(WORK, "restaurado"), confirmation: "RESTAURAR" });
    expect(r.status === 200, `restore ${r.status} ${r.text.slice(0, 300)}`);
    expect(fs.existsSync(r.json.safety_backup), "backup de segurança ausente");
    memo.restoredRoot = r.json.documents_root; saveMemo();
    await login(owner, memo.ownerEmail, memo.ownerPassword);
    const c = await owner.get("/api/clients");
    expect(!c.json.clients.some(x => x.name === "Cliente criado depois do backup") && c.json.clients.some(x => x.id === memo.clientId), "dados não correspondem ao backup");
    const restoredCopy = path.join(r.json.documents_root, ...memo.storageKey.split("/"));
    expect(shaFile(restoredCopy) === memo.editedSha, "cópia restaurada difere");
    return `backup de segurança: ${r.json.safety_backup}`;
  });

  await step("P10", "restauração recusa destino com junção/link e não grava fora; a pasta de documentos não muda", async () => {
    const target = path.join(WORK, "alvo-com-juncao"); fs.mkdirSync(target, { recursive: true });
    const trap = path.join(WORK, "armadilha"); fs.mkdirSync(trap, { recursive: true });
    fs.symlinkSync(trap, path.join(target, "ws"), "junction");
    const r = await owner.post("/api/desktop/backup/restore", { path: memo.backup, documentsTarget: target, confirmation: "RESTAURAR" });
    expect(r.status === 422 && r.json.code === "link", `restore com junção: ${r.status} ${r.text.slice(0, 200)}`);
    expect(fs.readdirSync(trap).length === 0, "gravou na pasta apontada pela junção");
    const o = await owner.post(`/api/desktop/documents/versions/${memo.versionId}/open`, { mode: "edit" });
    expect(o.status === 200 && fs.realpathSync(o.json.path).startsWith(fs.realpathSync(memo.restoredRoot)), `pasta de documentos mudou: ${o.text.slice(0, 200)}`);
  });

  await step("P06", "relocalização explícita da pasta de cópias", async () => {
    const empty = path.join(WORK, "vazia"); fs.mkdirSync(empty, { recursive: true });
    const chk = await owner.post("/api/desktop/storage/check", { path: empty });
    expect(chk.status === 200 && chk.json.missing > 0, "verificação");
    const no = await owner.post("/api/desktop/storage/root", { path: empty });
    expect(no.status === 409, `relocalizar com ausentes sem confirmação: ${no.status}`);
    const back = await owner.post("/api/desktop/storage/root", { path: docsDefault() });
    expect(back.status === 200 && back.json.missing === 0, `voltar para a pasta original: ${back.status} ${back.text.slice(0, 200)}`);
    const page = await owner.get(`/app/documentos/${memo.documentId}`);
    expect(page.status === 200, "documento após relocalização");
  });

  await step("P07", "5 senhas erradas bloqueiam a conta temporariamente", async () => {
    const a = new Agent("brute");
    for (let i = 0; i < 5; i++) await a.post("/api/desktop/auth/login", { email: memo.otherEmail, password: "senha-errada-" + i + "xxxxx" });
    const locked = await a.post("/api/desktop/auth/login", { email: memo.otherEmail, password: memo.otherPassword });
    expect(locked.status === 429, `deveria bloquear (${locked.status})`);
  });

  await step("P08", "recuperação da conta proprietária com a chave, sem internet", async () => {
    const next = crypto.randomBytes(12).toString("base64url") + "Cc3!";
    const r = await new Agent("rec").post("/api/desktop/auth/recover", { email: memo.ownerEmail, recoveryKey: memo.recoveryKey, password: next, passwordConfirmation: next });
    expect(r.status === 200 && r.json.recoveryKey && r.json.recoveryKey !== memo.recoveryKey, `recover ${r.status}`);
    const old = await new Agent("old").post("/api/desktop/auth/login", { email: memo.ownerEmail, password: memo.ownerPassword });
    expect(old.status === 401, "senha antiga ainda funciona");
    memo.ownerPassword = next; memo.recoveryKey = r.json.recoveryKey; saveMemo();
    await login(new Agent("new"), memo.ownerEmail, next);
    const reuse = await new Agent("reuse").post("/api/desktop/auth/recover", { email: memo.ownerEmail, recoveryKey: "AAAAA-AAAAA-AAAAA-AAAAA-AAAAA", password: next, passwordConfirmation: next });
    expect(reuse.status === 401, "chave inválida aceita");
  });

  await step("P09", "logout encerra a sessão", async () => {
    const r = await owner.post("/api/desktop/auth/logout", {});
    expect(r.status === 200, "logout");
    const after = await owner.get("/api/clients");
    expect(after.status === 401, `sessão continua válida (${after.status})`);
  });
}

try {
  if (PHASE === "seed") await seed(); else await verify();
} catch (e) {
  steps.push({ id: "X", name: "erro inesperado", ok: false, detail: String(e?.stack ?? e) });
}
const report = { ok: steps.length > 0 && steps.every(s => s.ok), phase: PHASE, base: BASE, platform: process.platform, arch: process.arch, node: process.version, steps };
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(report.ok ? `SELFTEST ${PHASE}: OK (${steps.length} passos)` : `SELFTEST ${PHASE}: FALHOU`);
process.exit(report.ok ? 0 : 1);
