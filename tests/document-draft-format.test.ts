import { describe, expect, it } from "vitest";
import { decodeRevision, decodeTemplate, DRAFT_SOURCE, encodeRevision, encodeTemplate, fillTemplate, MAX_DRAFT_TEXT, revisionInput, templateFields } from "@/lib/documents/draft-format";

describe("plain text draft format", () => {
  it("deduplicates fields and substitutes every occurrence without evaluating values", () => {
    expect(templateFields("{{cliente}} / {{cliente}} / {{data}}")).toEqual(["cliente", "data"]);
    expect(fillTemplate("{{cliente}} / {{cliente}}", { cliente: "<script>test</script> {{outro}} $&" })).toBe("<script>test</script> {{outro}} $& / <script>test</script> {{outro}} $&");
  });
  it.each(["{{a.b}}", "{{CLIENTE}}", "{{ cliente }}", "{{cliente", "cliente}}", "{{}}"])("rejects malformed placeholder %s", value => {
    expect(() => templateFields(value)).toThrow();
  });
  it("rejects missing, blank, inherited and extra fields", () => {
    for (const values of [{}, { cliente: " " }, { cliente: "A", extra: "B" }, Object.create({ cliente: "A" })]) {
      expect(() => fillTemplate("Olá {{cliente}}", values)).toThrow();
    }
  });
  it("bounds expanded content and number of fields", () => {
    expect(() => fillTemplate("{{a}}".repeat(20), { a: "x".repeat(10_000) })).toThrow();
    expect(() => templateFields(Array.from({ length: 51 }, (_, i) => `{{a${i}}}`).join(""))).toThrow();
    expect(() => encodeRevision("x".repeat(MAX_DRAFT_TEXT + 1))).toThrow();
  });
  it("round trips unicode, newlines and whitespace exactly", () => {
    const body = "  Revisão sintética — ação\nlinha 2\n";
    expect(decodeRevision({ source: DRAFT_SOURCE, notes: encodeRevision(body) })).toBe(body);
    expect(decodeTemplate(encodeTemplate(body))?.body).toBe(body);
  });
  it("does not interpret legacy upload notes or malformed envelopes as content", () => {
    expect(decodeRevision({ source: "UPLOAD", notes: encodeRevision("Text") })).toBeNull();
    expect(decodeRevision({ source: DRAFT_SOURCE, notes: "{broken" })).toBeNull();
    expect(decodeTemplate({ variables: ["cliente"] })).toBeNull();
  });
  it("rejects forged author, status and document identity from revision payload", () => {
    const base = { operationId: "11111111-1111-4111-8111-111111111111", workspaceId: "ws-test", expectedVersion: 1, body: "Text" };
    for (const extra of [{ createdByUserId: "other" }, { status: "SIGNED" }, { documentId: "other" }]) {
      expect(revisionInput.safeParse({ ...base, ...extra }).success).toBe(false);
    }
  });
});
