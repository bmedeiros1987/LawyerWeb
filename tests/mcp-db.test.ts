// The MCP tools against a real PostgreSQL: tokens, per-call permissions, confidential matters,
// read-only guarantee and an audit trail without document content. Throw-away database.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The MCP route does not use browser sessions at all; this only keeps next-auth out of the test run.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import pg from "pg";
import yazl from "yazl";

const RUN = process.env.RUN_DB_TESTS === "1";

function docx(file: string, paragraphs: string[]) {
  return new Promise<void>((resolve, reject) => {
    const z = new yazl.ZipFile();
    z.addBuffer(Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'), "[Content_Types].xml");
    z.addBuffer(Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'), "_rels/.rels");
    z.addBuffer(Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(p => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`), "word/document.xml");
    z.end();
    z.outputStream.pipe(fs.createWriteStream(file)).on("close", resolve).on("error", reject);
  });
}

describe.skipIf(!RUN)("MCP somente leitura", () => {
  const dbName = `lm_mcp_test_${crypto.randomBytes(4).toString("hex")}`;
  const adminUrl = process.env.DATABASE_URL!;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mcp-"));
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let m: any = {}; let ws: any, owner: any, viewer: any, noDocs: any, a1: any, a2: any, b1: any, readerRole: any;
  const SECRET_WORD = "zyxwvu-segredo-da-materia";
  const run = async (tok: any, name: string, args: unknown = {}) => {
    const v = await m.verifyToken(tok.token); expect(v).toBeTruthy();
    const out = await m.callTool(v.grant, v.tokenId, name, args);
    return { ...out, data: out.isError ? null : JSON.parse(out.text.slice(out.text.indexOf("{"))) };
  };

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect(); await admin.query(`create database ${dbName}`); await admin.end();
    const url = new URL(adminUrl); url.pathname = "/" + dbName;
    Object.assign(process.env, { DATABASE_URL: url.toString(), MBLZ_DESKTOP: "1", MBLZ_DESKTOP_STATE_DIR: path.join(tmp, "estado"), MBLZ_DESKTOP_NO_LAUNCH: "1", MBLZ_DESKTOP_MIGRATIONS_DIR: path.resolve("prisma/migrations") });
    fs.mkdirSync(path.join(tmp, "estado"), { recursive: true });
    m = { ...(await import("@/lib/desktop/migrate")), ...(await import("@/lib/desktop/documents")), ...(await import("@/lib/desktop/db")), ...(await import("@/lib/mcp/tokens")), ...(await import("@/lib/mcp/tools")), prisma: (await import("@/lib/prisma")).prisma };
    await m.runDesktopMigrations();
    const p = m.prisma;
    ws = await p.workspace.create({ data: { name: "Escritório", slug: `t-${dbName}` } });
    const full = await p.workspaceRole.create({ data: { workspaceId: ws.id, name: "Proprietário", permissions: { allow: ["*"] } } });
    readerRole = await p.workspaceRole.create({ data: { workspaceId: ws.id, name: "Leitura", permissions: { allow: ["documents.view", "matters.view", "clients.view"] } } });
    const none = await p.workspaceRole.create({ data: { workspaceId: ws.id, name: "Sem documentos", permissions: { allow: ["clients.view"] } } });
    const mk = async (name: string, roleId: string) => { const u = await p.user.create({ data: { name } }); await p.workspaceMember.create({ data: { workspaceId: ws.id, userId: u.id, roleId } }); return { userId: u.id, member: await p.workspaceMember.findFirstOrThrow({ where: { userId: u.id }, include: { role: true } }) }; };
    owner = await mk("Titular", full.id); viewer = await mk("Leitor", readerRole.id); noDocs = await mk("Sem docs", none.id);
    const secret = await p.matter.create({ data: { workspaceId: ws.id, title: "Matéria sigilosa", secrecy: true } });
    const f = (n: string) => path.join(tmp, n);
    await docx(f("a1.docx"), ["CLÁUSULA 1. O valor é de R$ 10.000,00.", "CLÁUSULA 2. O prazo é de 30 dias."]);
    await docx(f("a2.docx"), ["CLÁUSULA 1. O valor é de R$ 12.500,00.", "CLÁUSULA 2. O prazo é de 15 dias."]);
    await docx(f("b1.docx"), [`CLÁUSULA 1. ${SECRET_WORD} confidencial.`]);
    a1 = await m.importDocument({ userId: owner.userId, workspaceId: ws.id, sourcePath: f("a1.docx"), name: "Contrato Aberto" });
    a2 = await m.importDocument({ userId: owner.userId, workspaceId: ws.id, sourcePath: f("a2.docx"), documentId: a1.documentId });
    b1 = await m.importDocument({ userId: owner.userId, workspaceId: ws.id, sourcePath: f("b1.docx"), name: "Documento Sigiloso", matterId: secret.id });
  }, 180_000);

  afterAll(async () => {
    await m.prisma?.$disconnect(); await m.pool?.().end();
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect(); await admin.query(`drop database if exists ${dbName} with (force)`); await admin.end();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("desligado por padrão: um token válido não abre nada até o titular ligar", async () => {
    const t = await m.createToken({ userId: viewer.userId, workspaceId: ws.id, name: "Claude" });
    expect(await m.verifyToken(t.token)).toBeNull();
    await m.setMcpEnabled(true);
    expect(await m.verifyToken(t.token)).toMatchObject({ name: "Claude" });
  });

  it("o segredo só é guardado como hash; token errado, adulterado ou de formato inválido não passa", async () => {
    const t = await m.createToken({ userId: viewer.userId, workspaceId: ws.id, name: "Hash" });
    const row = (await m.withClient((c: any) => c.query("select value from desktop.local_setting where key = $1", ["mcp_token:" + t.id]))).rows[0].value as string;
    expect(row).not.toContain(t.token.split(".")[1]);
    expect(await m.verifyToken(t.token.slice(0, -1) + (t.token.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(await m.verifyToken("lmcp_000000000000." + "A".repeat(43))).toBeNull();
    expect(await m.verifyToken("qualquer coisa")).toBeNull();
  });

  it("leitor vê só o que a tela de documentos mostraria: o documento sigiloso não aparece, nem na busca, nem na leitura", async () => {
    const t = await m.createToken({ userId: viewer.userId, workspaceId: ws.id, name: "Leitor" });
    const list = await run(t, "list_documents");
    expect(list.data.documents.map((d: any) => d.name)).toEqual(["Contrato Aberto"]);
    expect(list.data.documents[0].versions.map((v: any) => v.version)).toEqual([2, 1]);
    const found = await run(t, "search_documents", { query: SECRET_WORD });
    expect(found.data.hits).toHaveLength(0);
    const denied = await run(t, "read_document", { versionId: b1.versionId });
    expect(denied.isError).toBe(true);
    expect(denied.text).not.toContain(SECRET_WORD);
    // Matéria sigilosa exige acesso explícito, até para o titular: sem ele, também não vê.
    const ot = await m.createToken({ userId: owner.userId, workspaceId: ws.id, name: "Titular" });
    expect((await run(ot, "list_documents")).data.documents).toHaveLength(1);
    expect((await run(ot, "read_document", { versionId: b1.versionId })).isError).toBe(true);
    // Com o acesso concedido à matéria, passa a ver os dois.
    const secretId = (await m.prisma.documentVersion.findUniqueOrThrow({ where: { id: b1.versionId }, include: { document: true } })).document.matterId;
    await m.prisma.matterAccess.create({ data: { matterId: secretId, memberId: owner.member.id } });
    expect((await run(ot, "list_documents")).data.documents).toHaveLength(2);
    expect((await run(ot, "read_document", { versionId: b1.versionId })).data.text).toContain(SECRET_WORD);
  });

  it("lê o texto em janelas, busca no conteúdo e compara versões com o trecho literal; tudo marcado como dado não confiável", async () => {
    const t = await m.createToken({ userId: viewer.userId, workspaceId: ws.id, name: "Leitura" });
    const r1 = await run(t, "read_document", { versionId: a1.versionId, offset: 0, length: 20 });
    expect(r1.data).toMatchObject({ returned: 20, hasMore: true, next_offset: 20, version: 1 });
    expect(r1.text).toMatch(/DADO NÃO CONFIÁVEL/);
    const r2 = await run(t, "read_document", { versionId: a1.versionId, offset: r1.data.next_offset, length: 5000 });
    expect(r2.data.hasMore).toBe(false);
    expect(r1.data.text + r2.data.text).toContain("R$ 10.000,00");
    const s = await run(t, "search_documents", { query: "prazo" });
    expect(s.data.hits.some((h: any) => h.idType === "versionId")).toBe(true);
    const c = await run(t, "compare_versions", { leftVersionId: a1.versionId, rightVersionId: a2.versionId });
    expect(c.data.status).toBe("ok");
    expect(JSON.stringify(c.data.observations)).toContain("12.500,00");
    expect(c.data.observations.every((o: any) => o.check && o.sources.length)).toBe(true);
  });

  it("parâmetros inválidos e ferramenta desconhecida são recusados sem chamar o banco de documentos", async () => {
    const t = await m.createToken({ userId: viewer.userId, workspaceId: ws.id, name: "Param" });
    expect((await run(t, "read_document", { versionId: a1.versionId, length: 999999 })).isError).toBe(true);
    expect((await run(t, "read_document", { versionId: a1.versionId, extra: 1 })).isError).toBe(true);
    expect((await run(t, "delete_document", { id: "x" })).isError).toBe(true);
  });

  it("a permissão é conferida a cada chamada: ao perder documents.view, o mesmo token deixa de funcionar", async () => {
    const t = await m.createToken({ userId: noDocs.userId, workspaceId: ws.id, name: "Sem permissão" });
    expect((await run(t, "list_documents")).isError).toBe(true);
    const t2 = await m.createToken({ userId: viewer.userId, workspaceId: ws.id, name: "Perde permissão" });
    expect((await run(t2, "list_documents")).isError).toBeFalsy();
    const none = await m.prisma.workspaceRole.findFirstOrThrow({ where: { workspaceId: ws.id, name: "Sem documentos" } });
    await m.prisma.workspaceMember.updateMany({ where: { userId: viewer.userId }, data: { roleId: none.id } });
    expect((await run(t2, "list_documents")).isError).toBe(true);
    await m.prisma.workspaceMember.updateMany({ where: { userId: viewer.userId }, data: { roleId: readerRole.id } });
  });

  it("revogado e expirado não passam; o usuário só revoga o que é dele", async () => {
    const t = await m.createToken({ userId: viewer.userId, workspaceId: ws.id, name: "Revogar" });
    expect(await m.revokeToken(t.id, noDocs.userId)).toBe(false);
    expect(await m.verifyToken(t.token)).toBeTruthy();
    expect(await m.revokeToken(t.id, viewer.userId)).toBe(true);
    expect(await m.verifyToken(t.token)).toBeNull();
    const e = await m.createToken({ userId: viewer.userId, workspaceId: ws.id, name: "Expira", days: 1 });
    expect(await m.verifyToken(e.token, Date.now() + 2 * 86_400_000)).toBeNull();
    const list = await m.listTokens(viewer.userId);
    expect(list.find((x: any) => x.id === t.id).status).toBe("revoked");
    expect(JSON.stringify(list)).not.toContain(t.token.split(".")[1]);
  });

  it("revogação concorrente vence verifyToken e nunca é desfeita por um snapshot antigo", async () => {
    const t = await m.createToken({ userId: viewer.userId, workspaceId: ws.id, name: "Corrida" });
    const locker = await m.pool().connect();
    try {
      await locker.query("begin");
      await locker.query("select value from desktop.local_setting where key = $1 for update", ["mcp_token:" + t.id]);
      // Queue revoke first, then verification, while both wait for the same row lock.
      const revoke = m.revokeToken(t.id, viewer.userId, false, Date.now());
      await new Promise(r => setTimeout(r, 40));
      const verify = m.verifyToken(t.token, Date.now() + 120_000);
      await new Promise(r => setTimeout(r, 40));
      await locker.query("commit");
      expect(await revoke).toBe(true);
      expect(await verify).toBeNull();
    } finally {
      try { await locker.query("rollback"); } catch { /* already committed */ }
      locker.release();
    }
    expect(await m.verifyToken(t.token)).toBeNull();
    const raw = (await m.withClient((c: any) => c.query("select value from desktop.local_setting where key = $1", ["mcp_token:" + t.id]))).rows[0].value;
    expect(JSON.parse(raw).revokedAt).not.toBeNull();
  });

  it("limite de acessos ativos por usuário", async () => {
    let last: any;
    for (let i = 0; i < 12; i++) { try { await m.createToken({ userId: noDocs.userId, workspaceId: ws.id, name: `n${i}` }); } catch (e) { last = e; break; } }
    expect(last?.status).toBe(409);
  });

  it("nada foi alterado: documentos, versões e arquivos intactos; auditoria registra a chamada sem conteúdo nem a pergunta", async () => {
    const before = { docs: await m.prisma.legalDocument.count(), vers: await m.prisma.documentVersion.count() };
    const t = await m.createToken({ userId: viewer.userId, workspaceId: ws.id, name: "Auditoria" });
    const file = path.join(tmp, "estado", "documentos", ...a1.storageKey.split("/"));
    const sha = () => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const h0 = sha();
    await run(t, "search_documents", { query: "pergunta-sigilosa-do-usuario" });
    await run(t, "read_document", { versionId: a1.versionId });
    expect(sha()).toBe(h0);
    expect({ docs: await m.prisma.legalDocument.count(), vers: await m.prisma.documentVersion.count() }).toEqual(before);
    const logs = await m.prisma.activityLog.findMany({ where: { type: "MCP_TOOL_CALLED", userId: viewer.userId } });
    expect(logs.length).toBeGreaterThanOrEqual(2);
    const dump = JSON.stringify(logs);
    expect(dump).not.toContain("pergunta-sigilosa-do-usuario");
    expect(dump).not.toContain("10.000,00");
    expect(dump).not.toContain(SECRET_WORD);
    expect(logs.some((l: any) => l.metadata.tool === "search_documents" && l.metadata.queryLength === "pergunta-sigilosa-do-usuario".length)).toBe(true);
  });
  it("endpoint HTTP: 401 sem token válido, 202 para notificação, resposta JSON-RPC com token, 429 acima do limite; sessão de navegador não vale", async () => {
    const { POST } = await import("@/app/api/desktop/mcp/route");
    const { resetRateLimitForTests, LIMIT_PER_MINUTE } = await import("@/lib/mcp/rate-limit");
    resetRateLimitForTests();
    const t = await m.createToken({ userId: viewer.userId, workspaceId: ws.id, name: "HTTP" });
    const post = (body: unknown, auth?: string) => POST(new Request("http://127.0.0.1:3000/api/desktop/mcp", { method: "POST", headers: { host: "127.0.0.1:3000", "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }));
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(401);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, "Bearer lmcp_000000000000." + "A".repeat(43))).status).toBe(401);
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" }, `Bearer ${t.token}`)).status).toBe(202);
    const init = await post({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-06-18" } }, `Bearer ${t.token}`);
    expect(init.status).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe("lawyermind");
    const call = await (await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_documents", arguments: {} } }, `Bearer ${t.token}`)).json();
    expect(call.result.isError).toBe(false);
    expect(call.result.content[0].text).toContain("Contrato Aberto");
    let last = 200;
    for (let i = 0; i < LIMIT_PER_MINUTE + 2 && last !== 429; i++) last = (await post({ jsonrpc: "2.0", id: 4, method: "ping" }, `Bearer ${t.token}`)).status;
    expect(last).toBe(429);
    await m.setMcpEnabled(false);
    resetRateLimitForTests();
    expect((await post({ jsonrpc: "2.0", id: 5, method: "ping" }, `Bearer ${t.token}`)).status).toBe(401); // desligado pelo titular
    await m.setMcpEnabled(true);
  });
  it("cadeia completa: cliente MCP -> ponte stdio -> endpoint HTTP -> banco, com o arquivo de endpoint que o servidor grava", async () => {
    const { POST } = await import("@/app/api/desktop/mcp/route");
    const { writeEndpoint, ENDPOINT_FILE } = await import("@/lib/mcp/endpoint");
    const server = http.createServer((req, res) => {
      let b = ""; req.on("data", d => (b += d)).on("end", async () => {
        const r = await POST(new Request(`http://${req.headers.host}${req.url}`, { method: "POST", headers: req.headers as Record<string, string>, body: b }));
        res.writeHead(r.status, { "Content-Type": "application/json" }); res.end(await r.text());
      });
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const port = String((server.address() as { port: number }).port);
    process.env.PORT = port; // the route's proxy-style host check is not in this path; the endpoint file is
    const stateDir = path.join(tmp, "estado");
    writeEndpoint(stateDir, port);
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, ENDPOINT_FILE), "utf8")).url).toBe(`http://127.0.0.1:${port}/api/desktop/mcp`);
    const t = await m.createToken({ userId: viewer.userId, workspaceId: ws.id, name: "Cadeia" });
    const child = spawn(process.execPath, [path.resolve("desktop/runtime/mcp-bridge.mjs")], { env: { PATH: process.env.PATH ?? "", LAWYERMIND_MCP_TOKEN: t.token, LAWYERMIND_STATE_DIR: stateDir } as unknown as NodeJS.ProcessEnv });
    const lines: any[] = []; let buf = "";
    child.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    const waitFor = async (n: number) => { for (let i = 0; i < 200 && lines.length < n; i++) await new Promise(r => setTimeout(r, 25)); expect(lines.length).toBeGreaterThanOrEqual(n); };
    const send = (o: unknown) => child.stdin.write(JSON.stringify(o) + "\n");
    try {
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "teste", version: "1" } } });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_documents", arguments: { query: "prazo" } } });
      send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_document", arguments: { versionId: b1.versionId } } });
      await waitFor(4);
      expect(lines.map(l => l.id)).toEqual([1, 2, 3, 4]);
      expect(lines[0].result.serverInfo.name).toBe("lawyermind");
      expect(lines[1].result.tools).toHaveLength(4);
      expect(lines[2].result.content[0].text).toContain("Contrato Aberto");
      expect(lines[3].result.isError).toBe(true); // documento sigiloso: negado de ponta a ponta
      expect(JSON.stringify(lines)).not.toContain(SECRET_WORD);
    } finally { child.kill(); server.close(); }
  });
});
