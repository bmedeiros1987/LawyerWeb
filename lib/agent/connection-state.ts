export type OpenClawConnectionState = "CONNECTED" | "DEGRADED" | "NOT_CONNECTED";

// Only the canonical status "CONNECTED" counts as connected. A stored row with
// any other status (or none) is never presented as connected.
export function openClawConnectionState(connection: { status?: string | null } | null | undefined): OpenClawConnectionState {
  if (!connection) return "NOT_CONNECTED";
  return connection.status === "CONNECTED" ? "CONNECTED" : "DEGRADED";
}

export function isOpenClawConnected(connection: { status?: string | null } | null | undefined): boolean {
  return openClawConnectionState(connection) === "CONNECTED";
}
