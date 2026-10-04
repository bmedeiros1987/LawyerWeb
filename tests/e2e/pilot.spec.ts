import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { beginChallenge, finishChallenge } from "@/lib/local-auth/service";
import type { AuthMail } from "@/lib/local-auth/mail";

// Connection guard runs in vitest.e2e.config.ts before this module or Prisma is imported.
const root = process.cwd(), origin = "http://127.0.0.1:3137", output = resolve(root, "artifacts/pilot-e2e");
const syntheticPassword = "Synthetic-only pilot password 2026";
const users: { id: string; email: string }[] = [], workspaceIds: string[] = [];
const evidence: { name: string; detail?: unknown }[] = [];
let server: ChildProcess, browser: Browser, log = "";
const report = (name: string, detail?: unknown) => { evidence.push({ name, detail }); console.log(`PASS: ${name}`); };
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const poll = <T>(fn: () => T | Promise<T>) => expect.poll(fn, { timeout: 30_000, interval: 100 });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitServer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next test server exited ${server.exitCode}`);
    try { const response = await fetch(`${origin}/login`); if (response.ok) return; } catch { /* starting */ }
    await sleep(300);
  }
  throw new Error("Next test server did not start");
}
async function context() {
  const value = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  value.setDefaultTimeout(60_000);
  await value.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
  return value;
}
async function login(page: Page, user: { email: string }) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("E-mail", { exact: true }).fill(user.email);
  await page.getByLabel("Senha", { exact: true }).fill(syntheticPassword);
  const response = page.waitForResponse(r => r.url().endsWith("/api/auth/local/login") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  expect((await response).status()).toBe(200);
  await page.waitForURL(url => url.pathname.startsWith("/app"));
}
async function setup(page: Page, userId: string, suffix: string) {
  await page.waitForURL("**/app/setup");
  await page.getByLabel("Nome do escritório ou departamento jurídico").fill(`Synthetic Pilot ${suffix}`);
  const response = page.waitForResponse(r => r.url().endsWith("/api/workspaces") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Criar meu workspace" }).click();
  const result = await response; expect(result.status()).toBe(201);
  await page.waitForURL(url => url.pathname === "/app");
  // The UI performs a full navigation immediately after201; read committed membership, not an evicted response body.
  const { workspaceId } = await prisma.workspaceMember.findFirstOrThrow({ where: { userId }, select: { workspaceId: true } });
  workspaceIds.push(workspaceId);
  expect(await prisma.workspaceMember.count({ where: { userId, workspaceId } })).toBe(1);
  return workspaceId as string;
}
async function screenshot(page: Page, name: string) {
  // Evidence annotation only; the application assets are not altered or represented as delivered.
  await page.evaluate(() => {
    const banner = document.createElement("div"); banner.id = "synthetic-evidence-banner";
    banner.textContent = "DADOS SINTÉTICOS · marca textual provisória · SEM LOGO APROVADO / SEM TIMBRADO VCL";
    banner.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#ffedb0;color:#172c47;padding:8px;font:13px sans-serif;text-align:center";
    document.body.append(banner);
  });
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  await page.locator("#synthetic-evidence-banner").evaluate(element => element.remove());
}

beforeAll(async () => {
  await mkdir(output, { recursive: true });
  for (let i = 0; i < 2; i++) {
    const email = `pilot-${randomUUID()}@example.invalid`; let captured: AuthMail | undefined;
    await beginChallenge(email, "REGISTER", async mail => { captured = mail; });
    if (!captured) throw new Error("Synthetic registration challenge missing");
    const { userId } = await finishChallenge({ ...captured, name: `Synthetic Pilot ${i}`, password: syntheticPassword });
    users.push({ id: userId, email });
  }
  report("two synthetic accounts confirmed through real registration service with in-memory fake mail");
  const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development", AUTH_LOCAL_ENABLED: "true", NEXT_PUBLIC_APP_URL: origin,
    AUTH_SMTP_HOST: "", AUTH_SMTP_USER: "", AUTH_SMTP_PASSWORD: "", AUTH_MAIL_FROM: "", NEXT_TELEMETRY_DISABLED: "1" };
  server = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3137"], { cwd: root, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [server.stdout, server.stderr]) stream?.on("data", data => { log = (log + data.toString()).slice(-100_000); });
  await waitServer();
  const executablePath = process.env.CHROMIUM_PATH ?? ["/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
  if (!executablePath) throw new Error("Installed Chromium required for pilot E2E");
  browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
});

afterAll(async () => {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await Promise.race([new Promise<void>(resolve => server.once("exit", () => resolve())), sleep(5000)]); if (server.exitCode === null) server.kill("SIGKILL"); }
  await writeFile(`${output}/server.log`, log);
  await writeFile(`${output}/evidence.json`, JSON.stringify({ commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), environment: "loopback Next dev + disposable PostgreSQL + installed Chromium", noRealMail: true, placeholders: "text-only brand; no approved logo or VCL letterhead", checks: evidence }, null, 2));
  if (users.length) {
    const memberships = await prisma.workspaceMember.findMany({ where: { userId: { in: users.map(u => u.id) } }, select: { workspaceId: true } });
    await prisma.workspace.deleteMany({ where: { id: { in: [...workspaceIds, ...memberships.map(m => m.workspaceId)] } } });
    await prisma.localAuthChallenge.deleteMany({ where: { email: { in: users.map(u => u.email) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } });
  }
  await prisma.$disconnect();
});

it("authenticates, creates a model, fills, reviews, versions, reopens and exports through real UI/API/database", async () => {
  const ownerContext = await context(), owner = await ownerContext.newPage();
  const failures: number[] = [];
  owner.on("response", response => { if (response.url().startsWith(`${origin}/api/documents/`) && response.status() === 409) failures.push(409); });
  await login(owner, users[0]);
  const cookies = await ownerContext.cookies(); expect(cookies.find(c => c.name === "lawyermind.session")).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  expect(await prisma.localSession.count({ where: { userId: users[0].id } })).toBe(1);
  const workspaceId = await setup(owner, users[0].id, "owner");
  report("real password login, opaque HttpOnly session and isolated workspace onboarding");
  await owner.goto(`${origin}/app/documentos`);
  await owner.getByText("Criar modelo de texto", { exact: true }).click();
  await owner.getByLabel("Nome do modelo", { exact: true }).fill("Modelo piloto sintético");
  const template = "DOCUMENTO SINTÉTICO — SEM VALIDADE\nCliente: {{cliente}}.\nObjeto: {{objeto}}.\nSem timbrado VCL.";
  await owner.getByLabel("Texto do modelo", { exact: true }).fill(template);
  const templateResponse = owner.waitForResponse(r => r.url().includes("/api/document-templates?") && r.request().method() === "POST");
  await owner.getByRole("button", { name: "Salvar modelo", exact: true }).click();
  const savedTemplate = await templateResponse; expect(savedTemplate.status()).toBe(201);
  const templateId = (await savedTemplate.json()).template.id;
  await owner.getByLabel("Nome do documento", { exact: true }).waitFor();
  await owner.reload();
  await owner.getByLabel("Modelo salvo", { exact: true }).selectOption(templateId);
  await owner.getByLabel("Nome do documento", { exact: true }).fill("Minuta sintética Marina");
  await owner.getByLabel("cliente", { exact: true }).fill("Pessoa Fictícia & Companhia");
  await owner.getByLabel("objeto", { exact: true }).fill("revisão <literal> de contrato fictício");
  await owner.getByRole("button", { name: "Preencher e abrir para revisão" }).click();
  await owner.waitForURL(/\/app\/documentos\/[^/]+$/);
  const documentId = new URL(owner.url()).pathname.split("/").at(-1)!;
  const documentUrl = owner.url();
  const editor = owner.getByRole("textbox", { name: "Texto da minuta", exact: true });
  await poll(() => editor.inputValue()).toContain("Pessoa Fictícia & Companhia");
  const initialBody = await editor.inputValue();
  expect(await prisma.documentTemplate.count({ where: { id: templateId } })).toBe(1);
  expect(await prisma.legalDocument.count({ where: { id: documentId, workspaceId } })).toBe(1);
  report("model saved/reloaded, fields filled literally and one draft created");
  const status = owner.getByRole("combobox", { name: "Status do documento ou contrato" });
  await status.selectOption("IN_REVIEW");
  await poll(() => status.inputValue()).toBe("IN_REVIEW");
  const version2 = `${initialBody}\nRevisão sintética salva, versão dois.`;
  await editor.fill(version2);
  expect(await owner.getByRole("button", { name: "Baixar PDF", exact: true }).isDisabled()).toBe(true);
  await owner.getByRole("button", { name: "Salvar nova versão", exact: true }).click();
  await poll(() => owner.locator(".matter-hero-main p").textContent()).toContain("versão 2");
  await poll(() => status.inputValue()).toBe("DRAFT");
  await status.selectOption("APPROVED");
  await poll(() => status.inputValue()).toBe("APPROVED");
  await poll(() => editor.getAttribute("readonly")).not.toBeNull();
  await status.selectOption("DRAFT");
  await poll(() => status.inputValue()).toBe("DRAFT");
  await poll(() => editor.getAttribute("readonly")).toBeNull();
  await owner.reload(); await poll(() => editor.inputValue()).toBe(version2);
  report("review then save v2; P2 regression: approved locks editor, draft unlocks it, reload preserves content");
  const otherTab = await ownerContext.newPage(); await otherTab.goto(documentUrl);
  const secondEditor = otherTab.getByRole("textbox", { name: "Texto da minuta", exact: true });
  await poll(() => secondEditor.inputValue()).toBe(version2);
  const version3 = `${version2}\nAlteração sintética de outra aba, versão três.`;
  await secondEditor.fill(version3); await otherTab.getByRole("button", { name: "Salvar nova versão", exact: true }).click();
  await poll(() => otherTab.locator(".matter-hero-main p").textContent()).toContain("versão 3");
  expect(await editor.inputValue()).toBe(version2);
  await owner.getByRole("button", { name: "Reabrir versão salva", exact: true }).click();
  await poll(() => editor.inputValue()).toBe(version3);
  await poll(() => owner.locator(".matter-hero-main p").textContent()).toContain("versão 3");
  const approval = owner.waitForResponse(r => r.url() === `${origin}/api/documents/${documentId}` && r.request().method() === "PATCH");
  await status.selectOption("APPROVED");
  const approvalResponse = await approval; expect(approvalResponse.status()).toBe(200); expect(approvalResponse.request().postDataJSON().expectedVersion).toBe(3);
  await poll(() => editor.getAttribute("readonly")).not.toBeNull();
  expect(failures).toEqual([]);
  report("P2 regression: cross-tab v3 reopen refreshes status control and approval sends expectedVersion=3, zero409");
  await otherTab.close();
  await owner.goto(`${origin}/app/documentos`); await owner.getByRole("link").filter({ hasText: "Minuta sintética Marina" }).click();
  await poll(() => editor.inputValue()).toBe(version3);
  await screenshot(owner, "reviewed-reopened-v3");
  for (const format of ["docx", "pdf"] as const) {
    const download = owner.waitForEvent("download");
    await owner.getByRole("button", { name: `Baixar ${format.toUpperCase()}`, exact: true }).click();
    const artifact = await download; expect(artifact.suggestedFilename()).toBe(`documento-v3.${format}`);
    await artifact.saveAs(`${output}/documento-v3.${format}`);
    const bytes = await readFile(`${output}/documento-v3.${format}`);
    if (format === "docx") {
      const zip = await JSZip.loadAsync(bytes), xml = await zip.file("word/document.xml")!.async("string");
      expect(xml).toContain("Pessoa Fictícia &amp; Companhia"); expect(xml).toContain("&lt;literal&gt;"); expect(xml).toContain("versão três.");
    } else { const pdf = await PDFDocument.load(bytes); expect(pdf.getPageCount()).toBe(1); expect(pdf.getSubject()).toContain(hash(version3)); }
    report(`real UI ${format.toUpperCase()} download of immutable v3`, { bytes: bytes.length, fileSHA256: hash(bytes), textSHA256: hash(version3) });
  }
  expect(await prisma.documentVersion.count({ where: { documentId } })).toBe(3);
  const strangerContext = await context(), stranger = await strangerContext.newPage();
  await login(stranger, users[1]); const otherWorkspaceId = await setup(stranger, users[1].id, "stranger");
  for (const endpoint of ["content", "export"]) {
    const extra = endpoint === "export" ? "&version=3&format=pdf" : "";
    expect((await strangerContext.request.get(`${origin}/api/documents/${documentId}/${endpoint}?workspaceId=${workspaceId}${extra}`)).status()).toBe(403);
    expect((await strangerContext.request.get(`${origin}/api/documents/${documentId}/${endpoint}?workspaceId=${otherWorkspaceId}${extra}`)).status()).toBe(404);
  }
  await strangerContext.close(); report("second authenticated account cannot read or export foreign document (403/404)");
  await owner.locator(".account-menu summary").click(); await owner.getByRole("button", { name: "Sair da conta", exact: true }).click();
  await owner.waitForURL("**/login"); expect(await prisma.localSession.count({ where: { userId: users[0].id } })).toBe(0);
  await owner.goto(documentUrl); await owner.waitForURL("**/login");
  await login(owner, users[0]); await owner.goto(documentUrl); await poll(() => editor.inputValue()).toBe(version3);
  report("logout revokes real session; protected route redirects; fresh login reopens unchanged v3");
  await ownerContext.close();
});
