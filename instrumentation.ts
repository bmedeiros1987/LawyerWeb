// Desktop app only: apply the bundled database migrations (non-destructively)
// before the local server accepts requests. No-op for the web deployment.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.MBLZ_DESKTOP !== "1") return;
  const { runDesktopMigrations } = await import("./lib/desktop/migrate");
  const result = await runDesktopMigrations(m => console.log(`[desktop] ${m}`));
  console.log(`[desktop] banco pronto (${result.applied.length} migração(ões) aplicada(s) agora)`);
}
