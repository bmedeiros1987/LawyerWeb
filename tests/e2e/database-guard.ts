export function requireDisposablePilotDatabase(env: Record<string, string | undefined>) {
  let url: URL;
  try { url = new URL(env.DATABASE_URL ?? ""); } catch { throw new Error("Pilot E2E database URL is invalid"); }
  // pg-connection-string allows query parameters (including host) to override the URL authority.
  // Reject all overrides and make the port explicit to avoid fallback to PGPORT.
  if (env.RUN_PILOT_E2E !== "1" || !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "5432" ||
      url.pathname !== "/mblz_ci" || url.search || url.hash || url.username !== "postgres") {
    throw new Error("Pilot E2E requires explicit opt-in and postgres on loopback:5432/mblz_ci without URL overrides");
  }
  return url;
}
