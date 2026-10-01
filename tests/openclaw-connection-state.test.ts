import { describe, expect, it } from "vitest";
import { isOpenClawConnected, openClawConnectionState } from "@/lib/agent/connection-state";

describe("OpenClaw connection state", () => {
  it("sem registro é não conectado", () => {
    expect(openClawConnectionState(null)).toBe("NOT_CONNECTED");
    expect(openClawConnectionState(undefined)).toBe("NOT_CONNECTED");
    expect(isOpenClawConnected(null)).toBe(false);
  });

  it("somente o status canônico CONNECTED conta como conectado", () => {
    expect(openClawConnectionState({ status: "CONNECTED" })).toBe("CONNECTED");
    expect(isOpenClawConnected({ status: "CONNECTED" })).toBe(true);
  });

  it.each(["ERROR", "DISCONNECTED", "DEGRADED", "connected", "", null, undefined])(
    "registro existente com status %j nunca é conectado",
    (status) => {
      expect(openClawConnectionState({ status })).toBe("DEGRADED");
      expect(isOpenClawConnected({ status })).toBe(false);
    },
  );
});
