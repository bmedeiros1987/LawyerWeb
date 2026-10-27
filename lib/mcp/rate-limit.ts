// Per-token sliding window kept in memory (the server is a single local process).
const hits = new Map<string, number[]>();
export const LIMIT_PER_MINUTE = 120;

export function allowCall(tokenId: string, now = Date.now(), limit = LIMIT_PER_MINUTE): boolean {
  const recent = (hits.get(tokenId) ?? []).filter(t => now - t < 60_000);
  if (recent.length >= limit) { hits.set(tokenId, recent); return false; }
  recent.push(now); hits.set(tokenId, recent);
  return true;
}
export const resetRateLimitForTests = () => hits.clear();
