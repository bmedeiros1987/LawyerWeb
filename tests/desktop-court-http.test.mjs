import { test } from "node:test";
import assert from "node:assert/strict";
import { djenOfficialUrl } from "../lib/desktop/court-djen.ts";
import { createCourtReadProvider } from "../lib/desktop/court-http.ts";
const number = "00000000020268260000";
const options = { source: "DATAJUD", number, court: "TJSP", secrecy: false, active: true,
  dataJudPublicKey: "synthetic-not-a-real-key", enabled: true };
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const process = { id: "synthetic", numeroProcesso: number,
  movimentos: [{ codigo: 1, nome: "Teste sintético", dataHora: "2026-10-07T13:00:00Z" }] };
test("transport is disabled by default, even with credentials", async () => {
  let calls = 0;
  const provider = createCourtReadProvider({ ...options, enabled: undefined, fetchImpl: async () => { calls++; throw new Error("network forbidden"); } });
  await assert.rejects(provider.read(null), /DESKTOP_NETWORK_DISABLED/); assert.equal(calls, 0);
});
test("secret, inactive and missing credentials refuse before making a request", async () => {
  for (const change of [{ secrecy: true }, { active: false }, { dataJudPublicKey: "" }]) {
    let calls = 0;
    const provider = createCourtReadProvider({ ...options, ...change, fetchImpl: async () => { calls++; return response({}); } });
    await assert.rejects(provider.read(null)); assert.equal(calls, 0);
  }
});
test("DataJud uses fixed HTTPS origin, exact term, explicit key and no redirects", async () => {
  const provider = createCourtReadProvider({ ...options, fetchImpl: async (url, init) => {
    assert.equal(url, "https://api-publica.datajud.cnj.jus.br/api_publica_tjsp/_search");
    assert.equal(init.headers.Authorization, "APIKey synthetic-not-a-real-key");
    assert.deepEqual(JSON.parse(init.body).query, { term: { numeroProcesso: number } });
    assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
    assert.ok(init.signal); return response({ hits: { hits: [{ _source: process }] } });
  } });
  assert.equal((await provider.read(null)).events.length, 1);
});
test("DataJud rejects no exact hit, ambiguous hit and malformed structure", async () => {
  for (const hits of [[], [{ _source: { ...process, numeroProcesso: "99999999920268260000" } }],
    [{ _source: process }, { _source: process }], [{ _source: { ...process, movimentos: null } }]]) {
    await assert.rejects(createCourtReadProvider({ ...options, fetchImpl: async () => response({ hits: { hits } }) }).read(null));
  }
});
test("429 stops without retry and hides provider body", async () => {
  let calls = 0;
  const provider = createCourtReadProvider({ ...options, fetchImpl: async () => { calls++; return response({ private: "do-not-leak" }, 429); } });
  await assert.rejects(provider.read(null), error => error.code === "RATE_LIMIT" && !error.message.includes("do-not-leak"));
  assert.equal(calls, 1);
});
test("timeout, HTTP failure, invalid JSON and oversize response are explicit failures", async () => {
  const transports = [
    async () => { throw new DOMException("private endpoint details", "TimeoutError"); },
    async () => response({}, 503),
    async () => new Response("not-json"),
    async () => response({}, 200, { "content-length": String(3 * 1024 * 1024) }),
    async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
  ];
  for (const fetchImpl of transports) await assert.rejects(createCourtReadProvider({ ...options, fetchImpl }).read(null));
});
test("DJEN remains dormant even when explicitly enabled, including backlog checkpoints", async () => {
  for (const cursor of [null, "window:2026-10-02", "window:2026-10-07", "unvalidated-page-3"]) {
    let calls = 0;
    const provider = createCourtReadProvider({ ...options, source: "DJEN", fetchImpl: async () => { calls++; return response({}); } });
    await assert.rejects(provider.read(cursor), /DJEN_PAGINATION_NOT_VALIDATED/); assert.equal(calls, 0);
  }
});
test("DJEN has no environment or credential path that activates it", async () => {
  let calls = 0;
  const provider = createCourtReadProvider({ ...options, source: "DJEN", enabled: undefined, fetchImpl: async () => { calls++; return response({}); } });
  await assert.rejects(provider.read(null), /DESKTOP_NETWORK_DISABLED/); assert.equal(calls, 0);
});
test("DJEN arbitrary HTTPS links are never classified as official", () => {
  assert.equal(djenOfficialUrl({ link: "https://attacker.invalid/publication" }), null);
  assert.equal(djenOfficialUrl({ hash: "bad", link: "https://comunicaapi.pje.jus.br/unverified" }), null);
  assert.equal(djenOfficialUrl({ hash: "synthetic_hash_123", link: "https://attacker.invalid" }),
    "https://comunicaapi.pje.jus.br/api/v1/comunicacao/synthetic_hash_123/certidao");
});
