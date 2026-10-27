// Desktop app only: apply the bundled database migrations (non-destructively)
// before the local server accepts requests. No-op for the web deployment.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.MBLZ_DESKTOP !== "1") return;
  const { runDesktopMigrations } = await import("./lib/desktop/migrate");
  const result = await runDesktopMigrations(m => console.log(`[desktop] ${m}`));
  console.log(`[desktop] banco pronto (${result.applied.length} migração(ões) aplicada(s) agora)`);
  // Where the optional MCP stdio bridge finds this server (the port is chosen at each start).
  try {
    const { writeEndpoint } = await import("./lib/mcp/endpoint");
    if (process.env.MBLZ_DESKTOP_STATE_DIR) writeEndpoint(process.env.MBLZ_DESKTOP_STATE_DIR, process.env.PORT);
  } catch (e) { console.warn("[desktop] endpoint MCP:", (e as Error).message); }
}
