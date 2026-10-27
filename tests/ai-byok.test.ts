import { describe, expect, it } from "vitest";
import { ByokConfigError, createByokProvider, extractJson, normalizeBaseUrl, validateApiKey, validateConfig } from "@/lib/ai/byok";
import { openKey, sealKey } from "@/lib/ai/secret-store";
import { askAboutExcerpt } from "@/lib/ai/chat";

const KEY = "sk-test-0123456789abcdef";
const TEXT = "A multa é de 10% sobre o valor do contrato. O prazo é de 30 dias.";
const answer = { answer: "Multa de 10%.", citations: [{ quote: "A multa é de 10% sobre o valor do contrato." }], suggestions: [], uncertainty: { level: "low", notes: [] } };
type Call = { url: string; init: RequestInit };
const fakeFetch = (reply: (c: Call) => Response, calls: Call[] = []) => (async (url: string, init: RequestInit) => { const c = { url, init }; calls.push(c); return reply(c); }) as unknown as typeof fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ask = (provider: ReturnType<typeof createByokProvider>) => askAboutExcerpt({ provider, text: TEXT, ref: { documentId: "d", versionId: "v" }, start: 0, end: 43, question: "Qual a multa?" });

describe("configuração", () => {
  it("só aceita https, ou http no próprio computador, sem credenciais nem parâmetros", () => {
    expect(normalizeBaseUrl("https://api.exemplo.com/v1/")).toBe("https://api.exemplo.com/v1");
    expect(normalizeBaseUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/v1");
    for (const bad of ["http://api.exemplo.com/v1", "ftp://x/y", "https://u:p@x.com/v1", "https://x.com/v1?key=1", "https://x.com/v1#a", "não é url"]) expect(() => normalizeBaseUrl(bad)).toThrow(ByokConfigError);
  });
  it("valida modelo, tipo e chave", () => {
    expect(validateConfig({ kind: "anthropic", model: " meu-modelo-1 " })).toEqual({ kind: "anthropic", model: "meu-modelo-1" });
    expect(() => validateConfig({ kind: "x", model: "m" })).toThrow();
    expect(() => validateConfig({ kind: "anthropic", model: "a b" })).toThrow();
    expect(() => validateConfig({ kind: "openai-compatible", model: "m" })).toThrow(/endereço/i);
    expect(() => validateApiKey("curta")).toThrow();
    expect(() => validateApiKey("com espaço no meio 123")).toThrow();
  });
  it("extrai o JSON mesmo com texto ou cerca de código em volta", () => {
    expect(extractJson("```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
    expect(extractJson("sem json")).toBeNull();
    expect(extractJson("{quebrado")).toBeNull();
  });
});

describe("provedor Anthropic", () => {
  it("envia só o trecho e a pergunta, com a chave só no cabeçalho, sem seguir redirecionamento", async () => {
    const calls: Call[] = [];
    const p = createByokProvider({ kind: "anthropic", model: "m1" }, KEY, fakeFetch(() => json({ content: [{ type: "text", text: JSON.stringify(answer) }] }), calls));
    const r = await ask(p);
    expect(r.status).toBe("answer");
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
    expect(init.redirect).toBe("error");
    expect(init.credentials).toBe("omit");
    const body = String(init.body);
    expect(body).not.toContain(KEY);
    expect(body).toContain("A multa é de 10%");
    expect(body).not.toContain("O prazo é de 30 dias"); // fora da seleção
  });
  it("declara que o trecho sai do computador", () => {
    expect(createByokProvider({ kind: "anthropic", model: "m" }, KEY).status().sendsDataOutsideDevice).toBe(true);
  });
});

describe("plano gratuito", () => {
  it("a marca de plano gratuito entra no status e no aviso, e só quando informada", () => {
    expect(validateConfig({ kind: "openai-compatible", model: "m", baseUrl: "https://api.groq.com/openai/v1", freeTier: true })).toMatchObject({ freeTier: true });
    expect(validateConfig({ kind: "anthropic", model: "m" })).not.toHaveProperty("freeTier");
    const free = createByokProvider({ kind: "openai-compatible", model: "m", baseUrl: "https://api.groq.com/openai/v1", freeTier: true }, KEY).status();
    expect(free.freeTier).toBe(true);
    expect(free.reason).toMatch(/GRATUITO/);
    expect(createByokProvider({ kind: "anthropic", model: "m" }, KEY).status().freeTier).toBeUndefined();
  });
});

describe("provedor compatível com OpenAI", () => {
  it("usa Bearer e o endereço configurado; servidor local não conta como 'fora do computador'", async () => {
    const calls: Call[] = [];
    const p = createByokProvider({ kind: "openai-compatible", model: "local", baseUrl: "http://localhost:11434/v1" }, KEY, fakeFetch(() => json({ choices: [{ message: { content: JSON.stringify(answer) } }] }), calls));
    expect(p.status().sendsDataOutsideDevice).toBe(false);
    expect((await ask(p)).status).toBe("answer");
    expect(calls[0].url).toBe("http://localhost:11434/v1/chat/completions");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(createByokProvider({ kind: "openai-compatible", model: "m", baseUrl: "https://api.exemplo.com/v1" }, KEY).status().sendsDataOutsideDevice).toBe(true);
  });
});

describe("falhas", () => {
  it("erro HTTP vira falha do provedor, sem vazar a chave nem o corpo da resposta", async () => {
    const p = createByokProvider({ kind: "anthropic", model: "m" }, KEY, fakeFetch(() => json({ error: `chave inválida ${KEY} ${TEXT}` }, 401)));
    const r = await ask(p);
    expect(r.status).toBe("error");
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(JSON.stringify(r)).not.toContain("multa");
  });
  it("resposta fora do formato é descartada e citação inventada não vira fonte", async () => {
    const bad = createByokProvider({ kind: "anthropic", model: "m" }, KEY, fakeFetch(() => json({ content: [{ type: "text", text: "olá" }] })));
    expect((await ask(bad)).status).toBe("error");
    const invented = { ...answer, citations: [{ quote: "O contrato tem multa de 50%." }] };
    const p = createByokProvider({ kind: "anthropic", model: "m" }, KEY, fakeFetch(() => json({ content: [{ type: "text", text: JSON.stringify(invented) }] })));
    const r = await ask(p);
    expect(r.status === "answer" && r.sources.verified).toEqual([]);
  });
  it("redirecionamento (fetch com redirect:error) é falha, não é seguido", async () => {
    const p = createByokProvider({ kind: "anthropic", model: "m" }, KEY, (async () => { throw new TypeError("redirect"); }) as unknown as typeof fetch);
    expect((await ask(p)).status).toBe("error");
  });
});

describe("cofre da chave", () => {
  const secret = "segredo-da-instalacao-0123456789";
  it("ida e volta; texto cifrado não contém a chave", () => {
    const s = sealKey(KEY, secret, "a");
    expect(s).not.toContain(KEY);
    expect(openKey(s, secret, "a")).toBe(KEY);
  });
  it("não abre com outro segredo, outras configurações (AAD) ou valor adulterado", () => {
    const s = sealKey(KEY, secret, "anthropic|m1");
    expect(openKey(s, "outro-segredo-0123456789", "anthropic|m1")).toBeNull();
    expect(openKey(s, secret, "anthropic|m1|https://outro.com")).toBeNull();
    const parts = s.split("."); parts[3] = Buffer.from("x".repeat(20)).toString("base64");
    expect(openKey(parts.join("."), secret, "anthropic|m1")).toBeNull();
    expect(openKey("lixo", secret, "x")).toBeNull();
  });
});
