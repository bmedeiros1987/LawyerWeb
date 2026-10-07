// Creates its own PostgreSQL cluster; never adopts DATABASE_URL or an existing DB.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import pg from "pg";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-court-exclusive-"));
const cluster = path.join(root, "cluster"), state = path.join(root, "state");
const binaries = path.resolve("desktop/src-tauri/resources/postgres/bin");
const runId = crypto.randomBytes(16).toString("hex"), database = "mblz_test_" + runId;
const password = crypto.randomBytes(32).toString("hex");
const passwd = path.join(root, "password"); fs.writeFileSync(passwd, password, { mode: 0o600 });
let started = false, app;
try {
const port = await new Promise((resolve, reject) => {
  const server = net.createServer(); server.on("error", reject);
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
});
  execFileSync(path.join(binaries, "initdb"), ["-D", cluster, "-U", "court_fixture", "-A", "scram-sha-256", "--pwfile", passwd, "--no-locale", "--encoding=UTF8"], { stdio: "pipe" });
  fs.mkdirSync(state);
  execFileSync(path.join(binaries, "pg_ctl"), ["-D", cluster, "-l", path.join(root, "postgres.log"),
    "-o", "-h 127.0.0.1 -p " + port + " -c unix_socket_directories='' -c max_connections=30", "-w", "start"], { stdio: "pipe" });
  started = true;
  const base = new URL("postgresql://court_fixture:" + password + "@127.0.0.1:" + port + "/postgres");
  const client = new pg.Client({ connectionString: base.toString() });
  await client.connect();
  await client.query('create database "' + database + '"');
  const systemId = (await client.query("select system_identifier::text from pg_control_system()")).rows[0].system_identifier;
  await client.end();
  base.pathname = "/" + database;
  const manifest = path.join(root, "manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ runId, database, host: "127.0.0.1", port, cluster, state,
    systemId, exclusive: true, disposable: true, expiresAt: Date.now() + 30 * 60_000,
    provisioner: "scripts/validate-desktop-courts.mjs" }));
  const env = { ...process.env, DATABASE_URL: base.toString(), RUN_COURT_DB_TESTS: "1",
    COURT_DB_MANIFEST: manifest, COURT_DB_RUN_ID: runId, MBLZ_DESKTOP: "1",
    MBLZ_DESKTOP_STATE_DIR: state, MBLZ_DESKTOP_MIGRATIONS_DIR: path.resolve("prisma/migrations"),
    NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "test",
    COURT_UI_FIXTURE_FILE: process.env.COURT_VALIDATE_UI === "1" ? path.join(root, "ui-fixture.json") : "" };
  // An explicit suite path prevents unrelated DB suites from operating on this cluster.
  execFileSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/desktop-court-store-db.test.ts"], { env, stdio: "inherit" });
  console.log("Exclusive PostgreSQL cluster validated; no existing database used.");
  if (process.env.COURT_VALIDATE_UI === "1") {
    const webPort = await new Promise((resolve, reject) => {
      const server = net.createServer(); server.on("error", reject);
      server.listen(0, "127.0.0.1", () => { const value = server.address().port; server.close(() => resolve(value)); });
    });
    const stop = path.join(root, "stop-ui");
    app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(webPort)],
      { env: { ...env, NODE_ENV: "production", PORT: String(webPort) }, stdio: ["ignore", "pipe", "pipe"] });
    app.stdout.pipe(process.stdout); app.stderr.pipe(process.stderr);
    for (let attempt = 0; attempt < 60; attempt++) {
      try { const response = await fetch("http://127.0.0.1:" + webPort + "/api/desktop/status"); if (response.ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const fixture = JSON.parse(fs.readFileSync(env.COURT_UI_FIXTURE_FILE, "utf8"));
    console.log(JSON.stringify({ fixtureUrl: "http://127.0.0.1:" + webPort + "/app/processos/" + fixture.matterId,
      otherMatterId: fixture.otherMatterId, stopFile: stop, syntheticLogin: fixture.email }));
    await new Promise(resolve => {
      const timer = setInterval(() => { if (fs.existsSync(stop)) { clearInterval(timer); clearTimeout(expiry); resolve(); } }, 500);
      const expiry = setTimeout(() => { clearInterval(timer); resolve(); }, 15 * 60_000);
    });
  }
} finally {
  if (app && app.exitCode === null) { app.kill("SIGTERM"); await new Promise(resolve => app.once("exit", resolve)); }
  if (started) execFileSync(path.join(binaries, "pg_ctl"), ["-D", cluster, "-m", "fast", "-w", "stop"], { stdio: "pipe" });
  fs.rmSync(root, { recursive: true, force: true });
}
