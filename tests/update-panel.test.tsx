// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UpdatePanel } from "@/components/desktop/update-panel";
import { controlledFetch } from "./helpers/controlled-fetch";
import { initialReleaseState } from "@/lib/desktop/release-check";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

for (const lateFailure of [false, true]) {
  it(`keeps the manual check when initial history arrives late (${lateFailure ? "failure" : "success"})`, async () => {
    const net = controlledFetch(); vi.stubGlobal("fetch", net.fetch);
    render(<UpdatePanel installedVersion="0.1.0"/>);
    expect(net.calls).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Consultar releases públicas" }));
    expect(net.calls).toHaveLength(2);
    await act(async () => { net.calls[1].respond(200, { ...initialReleaseState("0.1.0"), status: "no-release", message: "Consulta atual: nenhuma release estável." }); });
    expect(screen.getByRole("status").textContent).toContain("Consulta atual");
    await act(async () => { net.calls[0].respond(lateFailure ? 500 : 200, initialReleaseState("0.1.0")); });
    expect(screen.getByRole("status").textContent).toContain("Consulta atual");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Consultar releases públicas" }).hasAttribute("disabled")).toBe(false);
  });
}
