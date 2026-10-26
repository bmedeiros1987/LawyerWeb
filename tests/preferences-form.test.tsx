// @vitest-environment jsdom
// Reading preferences under fast clicks, out-of-order network answers and reset:
// the last choice is the one stored and shown, and a failure shows the last
// value the server confirmed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PreferencesForm } from "@/components/ui/preferences-form";
import { DEFAULT_PREFERENCES } from "@/lib/ui/preferences-defaults";
import type { DisplayPreferences } from "@/lib/ui/preferences";
import { controlledFetch, type Call } from "./helpers/controlled-fetch";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup() {
  const net = controlledFetch();
  vi.stubGlobal("fetch", net.fetch);
  let stored: DisplayPreferences = { ...DEFAULT_PREFERENCES };
  // The server applies each request when it answers (arrival order).
  const answer = async (call: Call, status = 200) => {
    if (status === 200) stored = call.method === "DELETE" ? { ...DEFAULT_PREFERENCES } : call.body as DisplayPreferences;
    await act(async () => { call.respond(status, status === 200 ? stored : { error: "falha simulada" }); await new Promise(r => setTimeout(r, 0)); });
  };
  const { container } = render(<div className="app-root"><PreferencesForm initial={{ ...DEFAULT_PREFERENCES }}/></div>);
  const root = container.querySelector<HTMLElement>(".app-root")!;
  const attrs = () => [root.dataset.theme, root.dataset.density, root.style.getPropertyValue("--fs")].join();
  const click = (label: string) => fireEvent.click(screen.getByLabelText(label));
  const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return { net, answer, attrs, click, flush, stored: () => stored, status: () => screen.getByRole("status").textContent };
}

describe("reading preferences form", () => {
  it("fast clicks: shown at once, one request at a time, the last choice is stored", async () => {
    const t = setup();
    t.click("Escuro"); t.click("Muito grande (130%)"); t.click("Máximo (150%)"); t.click("Compacta");
    await t.flush();
    expect(t.attrs()).toBe("dark,compact,1.5");
    expect(t.net.calls).toHaveLength(1);
    expect(t.status()).toBe("Salvando…");
    await t.answer(t.net.calls[0]);
    expect(t.net.calls).toHaveLength(2); // the clicks made meanwhile collapse into one save
    expect(t.net.calls[1].body).toEqual({ fontScale: 150, density: "compact", theme: "dark" });
    expect(t.status()).toBe("Salvando…"); // the first answer does not claim the latest is saved
    await t.answer(t.net.calls[1]);
    expect(t.stored()).toEqual({ fontScale: 150, density: "compact", theme: "dark" });
    expect(t.attrs()).toBe("dark,compact,1.5");
    expect(t.status()).toMatch(/^Salvo/);
    expect(t.net.maxInFlight()).toBe(1);
  });

  it("each click builds on the latest choice, not on a stale render", async () => {
    const t = setup();
    t.click("Escuro"); t.click("Compacta"); // same tick: no re-render in between
    await t.flush(); await t.answer(t.net.calls[0]); await t.answer(t.net.calls[1]);
    expect(t.stored()).toEqual({ fontScale: 100, density: "compact", theme: "dark" });
  });

  it("reset while a save is pending: the reset is sent after it and wins", async () => {
    const t = setup();
    t.click("Máximo (150%)");
    fireEvent.click(screen.getByRole("button", { name: "Restaurar padrão" }));
    await t.flush();
    expect(t.attrs()).toBe("system,comfortable,1");
    expect(t.net.calls.map(c => c.method)).toEqual(["PUT"]);
    await t.answer(t.net.calls[0]);
    expect(t.net.calls.map(c => c.method)).toEqual(["PUT", "DELETE"]);
    await t.answer(t.net.calls[1]);
    expect(t.stored()).toEqual(DEFAULT_PREFERENCES);
    expect(t.attrs()).toBe("system,comfortable,1");
    expect(t.status()).toMatch(/restauradas/);
  });

  it("a click right after reset starts from the defaults and is the one stored", async () => {
    const t = setup();
    t.click("Compacta");
    fireEvent.click(screen.getByRole("button", { name: "Restaurar padrão" }));
    t.click("Escuro");
    await t.flush(); await t.answer(t.net.calls[0]); await t.answer(t.net.calls[1]);
    expect(t.net.calls.map(c => c.method)).toEqual(["PUT", "PUT"]);
    expect(t.stored()).toEqual({ fontScale: 100, density: "comfortable", theme: "dark" });
  });

  it("a failed save shows the last value the server confirmed", async () => {
    const t = setup();
    t.click("Escuro"); await t.flush(); await t.answer(t.net.calls[0]);
    t.click("Claro"); await t.flush(); await t.answer(t.net.calls[1], 500);
    expect(t.stored().theme).toBe("dark");
    expect(t.attrs()).toBe("dark,comfortable,1");
    expect((screen.getByLabelText("Escuro") as HTMLInputElement).checked).toBe(true);
    expect(t.status()).toMatch(/última configuração salva/);
  });
});
