import { z } from "zod";

export const MAX_DRAFT_TEXT = 100_000;
export const DRAFT_SOURCE = "EDITOR_TEXT_V1";
export const TEMPLATE_CATEGORY = "EDITOR_TEXT_V1";
const text = z.string().min(1).max(MAX_DRAFT_TEXT).refine(v => v.trim().length > 0, "Informe o texto.");
export const templateInput = z.object({
  operationId: z.uuid(),
  workspaceId: z.string().min(1),
  name: z.string().trim().min(2).max(280),
  body: text,
}).strict();
export const draftInput = z.object({
  operationId: z.uuid(),
  workspaceId: z.string().min(1),
  name: z.string().trim().min(2).max(280),
  values: z.record(z.string(), z.string().max(10_000)),
}).strict();
export const revisionInput = z.object({
  operationId: z.uuid(),
  workspaceId: z.string().min(1),
  expectedVersion: z.number().int().min(0).max(1_000_000),
  body: text,
}).strict();
const templateData = z.object({ format: z.literal("lawyermind-template-v1"), body: text }).strict();
const revisionData = z.object({ format: z.literal("lawyermind-draft-v1"), body: text, operationId: z.uuid().optional() }).strict();

// Text only: no HTML, expression evaluation, remote fetching or recursive substitution.
export function templateFields(body: string): string[] {
  text.parse(body);
  const matches = [...body.matchAll(/\{\{([a-z][a-z0-9_]{0,63})\}\}/g)];
  if (body.replace(/\{\{([a-z][a-z0-9_]{0,63})\}\}/g, "").match(/\{\{|\}\}/)) {
    throw new Error("Use campos no formato {{nome_do_campo}}.");
  }
  const fields = [...new Set(matches.map(m => m[1]))];
  if (fields.length > 50) throw new Error("O modelo admite até 50 campos.");
  return fields;
}

export function fillTemplate(body: string, values: Record<string, string>): string {
  const fields = templateFields(body);
  if (Object.keys(values).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(values, key) || !values[key].trim())) {
    throw new Error("Preencha todos os campos do modelo, sem campos adicionais.");
  }
  return text.parse(body.replace(/\{\{([a-z][a-z0-9_]{0,63})\}\}/g, (_, key: string) => values[key]));
}

export function encodeTemplate(body: string) {
  templateFields(body);
  return templateData.parse({ format: "lawyermind-template-v1", body });
}

export function decodeTemplate(value: unknown) {
  const parsed = templateData.safeParse(value);
  if (!parsed.success) return null;
  try { return { ...parsed.data, fields: templateFields(parsed.data.body) }; } catch { return null; }
}

// Existing Text column, namespaced by source; legacy upload notes remain untouched.
export function encodeRevision(body: string, operationId?: string): string {
  return JSON.stringify(revisionData.parse({ format: "lawyermind-draft-v1", body, operationId }));
}

export function revisionOperation(value: { source: string; notes: string | null }): string | undefined {
  if (value.source !== DRAFT_SOURCE || !value.notes) return undefined;
  try { return revisionData.parse(JSON.parse(value.notes)).operationId; } catch { return undefined; }
}

export function decodeRevision(value: { source: string; notes: string | null }): string | null {
  if (value.source !== DRAFT_SOURCE || !value.notes) return null;
  try {
    const parsed = revisionData.safeParse(JSON.parse(value.notes));
    return parsed.success ? parsed.data.body : null;
  } catch { return null; }
}
