// Global search against a real PostgreSQL in desktop mode (synthetic data).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { desktopTestEnv, type DesktopTestEnv } from "./helpers/desktop-db";
import { docxBuffer, pdfBuffer } from "./helpers/fixtures";

const RUN = process.env.RUN_DB_TESTS === "1";
/* eslint-disable @typescript-eslint/no-explicit-any */

describe.skipIf(!RUN)("global search", () => {
  let env: DesktopTestEnv;
  let search: any, prisma: any, docs: any;
  let owner: any, limited: any, other: any;
  let ids: Record<string, string> = {};

  const memberOf = (userId: string, workspaceId: string) => prisma.workspaceMember.findFirstOrThrow({ where: { userId, workspaceId }, include: { role: true } });

  beforeAll(async () => {
    env = await desktopTestEnv("search");
    search = await import("@/lib/search/global");
    docs = await import("@/lib/desktop/documents");
    prisma = (await import("@/lib/prisma")).prisma;
    const ws = await prisma.workspace.create({ data: { name: "Escritório A", slug: `a-${env.dbName}` } });
    const wsB = await prisma.workspace.create({ data: { name: "Escritório B", slug: `b-${env.dbName}` } });
    const all = await prisma.workspaceRole.create({ data: { workspaceId: ws.id, name: "Sócia", permissions: { allow: ["*"] } } });
    const lim = await prisma.workspaceRole.create({ data: { workspaceId: ws.id, name: "Assistente", permissions: { allow: ["matters.view", "documents.view"] } } });
    const allB = await prisma.workspaceRole.create({ data: { workspaceId: wsB.id, name: "Sócio B", permissions: { allow: ["*"] } } });
    const [u1, u2, u3] = await Promise.all(["Marina", "Assistente", "Outro escritório"].map(name => prisma.user.create({ data: { name } })));
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: u1.id, roleId: all.id } });
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: u2.id, roleId: lim.id } });
    await prisma.workspaceMember.create({ data: { workspaceId: wsB.id, userId: u3.id, roleId: allB.id } });
    owner = await memberOf(u1.id, ws.id); limited = await memberOf(u2.id, ws.id); other = await memberOf(u3.id, wsB.id);

    const client = await prisma.client.create({ data: { workspaceId: ws.id, name: "Construtora Horizonte Fictícia Ltda", cpfCnpj: "12345678000190" } });
    const consult = await prisma.matter.create({ data: { workspaceId: ws.id, clientId: client.id, title: "Revisão de contrato de fornecimento", type: "ADVISORY" } });
    const secret = await prisma.matter.create({ data: { workspaceId: ws.id, clientId: client.id, title: "Assunto sigiloso de fusão", secrecy: true } });
    await prisma.matterAccess.create({ data: { matterId: secret.id, memberId: owner.id } });
    await prisma.client.create({ data: { workspaceId: wsB.id, name: "Construtora do Outro Escritório" } });

    const write = async (name: string, buf: Buffer) => { const f = path.join(env.work, name); fs.writeFileSync(f, buf); return f; };
    const imp = (sourcePath: string, matterId: string, name: string) => docs.importDocument({ userId: u1.id, workspaceId: ws.id, sourcePath, matterId, name });
    const contrato = await imp(await write("contrato.docx", await docxBuffer(["CLÁUSULA 7 – DA MULTA", "Em caso de rescisão antecipada, a multa será de 20% do valor remanescente."])), consult.id, "Contrato de fornecimento");
    const parecer = await imp(await write("parecer.pdf", pdfBuffer(["Introducao do parecer", "Conclusao: a clausula de exclusividade e abusiva"])), consult.id, "Parecer preliminar");
    const fusao = await imp(await write("fusao.docx", await docxBuffer(["Termo de confidencialidade da operação de fusão. Multa rescisória."])), secret.id, "Memorando da fusão");
    await imp(await write("digitalizado.pdf", pdfBuffer(["", ""])), consult.id, "Procuração digitalizada");
    await imp(await write("antigo.doc", Buffer.from("binário antigo")), consult.id, "Minuta antiga");
    ids = { client: client.id, consult: consult.id, secret: secret.id, contrato: contrato.versionId, contratoKey: contrato.storageKey, parecer: parecer.versionId, fusao: fusao.documentId };
  }, 180_000);
  afterAll(async () => { await env?.cleanup(); });

  const kinds = (r: any, k: string) => r.hits.filter((h: any) => h.kind === k);

  it("finds clients, matters and documents that exist, with links", async () => {
    const r = await search.globalSearch(owner, "horizonte");
    expect(kinds(r, "clients").map((h: any) => h.href)).toEqual([`/app/clientes/${ids.client}`]);
    const m = await search.globalSearch(owner, "fornecimento");
    expect(kinds(m, "matters")[0].href).toBe(`/app/processos/${ids.consult}`);
    expect(kinds(m, "documents").some((h: any) => h.title === "Contrato de fornecimento")).toBe(true);
    expect((await search.globalSearch(owner, "12.345.678")).hits.some((h: any) => h.kind === "clients")).toBe(true);
  });

  it("searches inside DOCX and PDF with document, version, page and excerpt (accents ignored)", async () => {
    const r = await search.globalSearch(owner, "rescisao antecipada", { kinds: ["content"] });
    const hit = kinds(r, "content")[0];
    expect(hit.title).toBe("Contrato de fornecimento");
    expect(hit.version).toBe(1);
    expect(hit.excerpt.match.toLowerCase()).toBe("rescisão antecipada");
    expect(hit.excerpt.before).toContain("Em caso de");
    const p = kinds(await search.globalSearch(owner, "exclusividade", { kinds: ["content"] }), "content")[0];
    expect(p.title).toBe("Parecer preliminar");
    expect(p.page).toBe(2);
  });

  it("reports files that were NOT searched: scan without text, unsupported format", async () => {
    const r = await search.globalSearch(owner, "qualquer coisa", { kinds: ["content"] });
    const notSearched = r.index.notSearched.map((x: any) => [x.name, x.status]);
    expect(notSearched).toContainEqual(["Procuração digitalizada", "no_text"]);
    expect(notSearched).toContainEqual(["Minuta antiga", "unsupported"]);
    expect(r.index.indexed).toBe(3);
  });

  it("re-indexes a working copy edited after import before searching", async () => {
    const copy = path.join(env.state, "documentos", ...ids.contratoKey.split("/"));
    fs.writeFileSync(copy, await docxBuffer(["CLÁUSULA 7 – DA MULTA", "Cláusula nova incluída pela revisora: arbitragem na câmara fictícia. Multa de 20% mantida."]));
    const r = await search.globalSearch(owner, "arbitragem", { kinds: ["content"] });
    expect(kinds(r, "content").map((h: any) => h.title)).toEqual(["Contrato de fornecimento"]);
  });

  it("respects permissions: no clients without clients.view; confidential matter and its file hidden", async () => {
    const r = await search.globalSearch(limited, "fusão");
    expect(r.unavailable.clients).toBeTruthy();
    expect(r.hits).toEqual([]);
    const c = await search.globalSearch(limited, "confidencialidade", { kinds: ["content"] });
    expect(kinds(c, "content")).toEqual([]);
    expect(c.index.notSearched.some((x: any) => x.name === "Memorando da fusão")).toBe(false);
    const o = await search.globalSearch(owner, "confidencialidade", { kinds: ["content"] });
    expect(kinds(o, "content").map((h: any) => h.title)).toEqual(["Memorando da fusão"]);
  });

  it("never returns another workspace's data", async () => {
    const r = await search.globalSearch(other, "construtora");
    expect(r.hits.map((h: any) => h.title)).toEqual(["Construtora do Outro Escritório"]);
    const c = await search.globalSearch(other, "multa", { kinds: ["content"] });
    expect(c.hits).toEqual([]);
  });

  it("treats wildcard characters literally and ignores 1-character queries", async () => {
    expect((await search.globalSearch(owner, "%%", { kinds: ["content"] })).hits.filter((h: any) => !h.excerpt?.match.includes("%"))).toEqual([]);
    expect((await search.globalSearch(owner, "a")).hits).toEqual([]);
    const pct = await search.globalSearch(owner, "20%", { kinds: ["content"] });
    expect(kinds(pct, "content")[0]?.excerpt?.match).toBe("20%");
  });
});
