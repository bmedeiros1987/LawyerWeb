// Replaceable AI provider contract for the document assistant. This file defines the seam only:
// no network call, credential, account lookup, environment variable or fallback model lives here.
// With no registered adapter the assistant is honestly unavailable.

export type ProviderStatus = {
  id: string;
  label: string;
  state: "available" | "unavailable";
  reason: string;
  /** True when the excerpt leaves this computer. Shown in the consent text. */
  sendsDataOutsideDevice: boolean;
  /** The owner marked this as a free/unpaid plan: providers often let free-tier content be used to improve their products. */
  freeTier?: boolean;
  /** Plain statements from the provider's official terms, once verified by a person. Never invented. */
  terms?: { retention?: string; training?: string; commercialUse?: string; checkedAt: string; source: string };
};

export type AiContext = {
  source: { documentId: string; versionId: string; start: number; end: number; excerptSha256: string };
  excerpt: string;
};
export type AiRequest = { question: string; context: AiContext; systemRules: string };

export interface AiProvider {
  status(): ProviderStatus;
  /** Must return a JSON-compatible value; chat.ts validates it. Must honour `signal`. */
  complete(request: AiRequest, signal: AbortSignal): Promise<unknown>;
}

export class ProviderUnavailable extends Error {
  constructor(public readonly provider: ProviderStatus) { super(provider.reason); }
}

export const unavailableProvider: AiProvider = Object.freeze({
  status: () => ({
    id: "none", label: "Nenhum provedor de IA conectado", state: "unavailable" as const,
    reason: "Nenhum provedor de IA foi conectado ou aprovado. Nenhum trecho de documento é enviado.", sendsDataOutsideDevice: false,
  }),
  complete: async () => { throw new ProviderUnavailable(unavailableProvider.status()); },
});

const adapters = new Map<string, () => AiProvider>();

/** Registers an adapter factory. Called only by code a maintainer adds after approval; there is no dynamic loading. */
export function registerProvider(id: string, factory: () => AiProvider) {
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(id) || adapters.has(id)) throw new Error("Identificador de provedor inválido ou repetido.");
  adapters.set(id, factory);
}

/** The configured provider, or the honest unavailable one when the id is empty or unknown. */
export function resolveProvider(id: string | undefined): AiProvider {
  const factory = id ? adapters.get(id) : undefined;
  return factory ? factory() : unavailableProvider;
}

export const clearProvidersForTests = () => adapters.clear();
