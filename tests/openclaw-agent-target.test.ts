import { describe, expect, it } from "vitest";
import { openClawAgentTarget } from "@/lib/agent/openclaw";

describe("OpenClaw agent target", () => {
  it("usa o alias estável do agente padrão", () => {
    expect(openClawAgentTarget("default")).toBe("openclaw/default");
  });

  it("mantém o ID explícito de um agente configurado", () => {
    expect(openClawAgentTarget("mblz")).toBe("openclaw/mblz");
  });
});
