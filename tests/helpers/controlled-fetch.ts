// A fetch double whose answers the test releases one by one, in any order.
export type Call = { method: string; url: string; body: unknown; respond: (status: number, json: unknown) => void };

export function controlledFetch() {
  const calls: Call[] = [];
  let inFlight = 0, maxInFlight = 0;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise<Response>(resolve => {
      calls.push({
        method: init?.method ?? "GET", url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined,
        respond: (status, json) => { inFlight--; resolve(new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } })); },
      });
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls, maxInFlight: () => maxInFlight };
}
