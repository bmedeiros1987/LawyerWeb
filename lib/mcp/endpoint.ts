// Tells the stdio bridge where the local server is listening (the port changes on every start).
import fs from "node:fs";
import path from "node:path";

export const ENDPOINT_FILE = "mcp-endpoint.json";

export function writeEndpoint(stateDir: string, port: string | undefined, pid = process.pid) {
  if (!port || !/^\d{2,5}$/.test(port)) return;
  const file = path.join(stateDir, ENDPOINT_FILE);
  const tmp = `${file}.${pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ url: `http://127.0.0.1:${port}/api/desktop/mcp`, pid, startedAt: new Date().toISOString() }), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
