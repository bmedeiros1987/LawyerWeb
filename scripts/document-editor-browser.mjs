// Component integration regression with the real editor/status controls and a synthetic API.
// No auth bypass route is added to the application; this Vite fixture binds loopback only.
import { createServer } from "vite";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { once } from "node:events";
const root = process.cwd();
const chrome = process.env.CHROMIUM_PATH || ["/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
if (!chrome) throw new Error("Set CHROMIUM_PATH to an installed Chromium browser");
const profile = await mkdtemp(join(tmpdir(), "lawyermind-browser-test-"));
const server = await createServer({ root, configFile: false, esbuild: { jsx: "automatic" },
  resolve: { alias: { "next/navigation": resolve(root, "tests/browser/navigation.ts"), "@": root } },
  server: { host: "127.0.0.1", port: 8771, strictPort: true } });
let browser, socket;
try {
  await server.listen();
  browser = spawn(chrome, ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  const debuggerUrl = await new Promise((yes, no) => {
    const timeout = setTimeout(() => no(new Error(`Browser startup timed out (${chrome}): ${stderr.slice(-2000)}`)), 15000);
    browser.stderr.on("data", data => {
      stderr += data;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); yes(match[1]); }
    });
    browser.on("exit", code => { clearTimeout(timeout); no(new Error(`Browser exited ${code} (${chrome}): ${stderr.slice(-2000)}`)); });
    browser.on("error", error => { clearTimeout(timeout); no(error); });
  });
  socket = new WebSocket(debuggerUrl);
  await once(socket, "open");
  let serial = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timer);
      message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetInfos } = await send("Target.getTargets");
  const { sessionId } = await send("Target.attachToTarget", { targetId: targetInfos.find(t => t.type === "page").targetId, flatten: true });
  const page = (method, params = {}) => send(method, params, sessionId);
  const evaluate = async expression => {
    const result = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (expression, label) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Assertion timed out: ${label}`);
  };
  await page("Page.navigate", { url: "http://127.0.0.1:8771/tests/browser/document-editor.html" });
  const editor = `document.querySelector('textarea[aria-label="Texto da minuta"]')`;
  await until(`${editor}?.value === "Texto sintético inicial" && ${editor}.readOnly`, "initial approved document read-only");
  const changeStatus = status => evaluate(`{const s=document.querySelector("select");s.value=${JSON.stringify(status)};s.dispatchEvent(new Event("change",{bubbles:true}));}`);
  await changeStatus("DRAFT");
  await until(`${editor}?.readOnly === false`, "APPROVED to DRAFT unlocks editor after refresh");
  await changeStatus("APPROVED");
  await until(`${editor}?.readOnly === true`, "DRAFT to APPROVED locks editor after refresh");
  await evaluate('Object.assign(window.draftFixture,{version:2,status:"DRAFT",body:"Texto sintético da outra aba"})');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Reabrir versão salva")).click()');
  await until(`${editor}?.value === "Texto sintético da outra aba" && document.querySelector("select").value === "DRAFT" && !${editor}.readOnly`, "reopen refreshes editor and status control");
  await changeStatus("APPROVED");
  await until('window.draftFixture.status === "APPROVED" && window.draftFixture.approvals.at(-1) === 2 && window.draftFixture.conflicts === 0', "approval after reopen uses latest expectedVersion");
  console.log("PASS: approved→draft; draft→approved; cross-tab reopen→approve uses latest version (0 conflicts)");
  await send("Browser.close");
} finally {
  socket?.close(); browser?.kill("SIGTERM");
  await server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
