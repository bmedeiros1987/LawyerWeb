// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UpdatePanel } from "@/components/desktop/update-panel";
import { controlledFetch } from "./helpers/controlled-fetch";
import { initialReleaseState } from "@/lib/desktop/release-check";
import { StrictMode } from "react";

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

const reply = (message: string) => ({ ...initialReleaseState("0.1.0"), message });

it("ignores initial history whose JSON finishes after the manual check", async () => {
  const net = controlledFetch();
  let finishJson!: (value: unknown) => void;
  const json = vi.fn(() => new Promise(resolve => { finishJson = resolve; }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json }).mockImplementation(net.fetch));
  render(<UpdatePanel installedVersion="0.1.0"/>);
  await act(async () => {});
  expect(json).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Consultar releases públicas" }));
  await act(async () => { net.calls[0].respond(200, reply("Consulta atual")); });
  await act(async () => { finishJson(reply("Histórico antigo")); });
  expect(screen.getByRole("status").textContent).toContain("Consulta atual");
});

it("lets a failed manual check retry without reviving old history errors", async () => {
  const net = controlledFetch(); vi.stubGlobal("fetch", net.fetch);
  render(<UpdatePanel installedVersion="0.1.0"/>);
  fireEvent.click(screen.getByRole("button", { name: "Consultar releases públicas" }));
  await act(async () => { net.calls[1].respond(503, { error: "Falha sintética" }); });
  expect(screen.getByRole("alert").textContent).toContain("Falha sintética");
  fireEvent.click(screen.getByRole("button", { name: "Consultar releases públicas" }));
  expect(screen.queryByRole("alert")).toBeNull();
  await act(async () => { net.calls[2].respond(200, reply("Retry atual")); });
  await act(async () => { net.calls[0].respond(500, {}); });
  expect(screen.getByRole("status").textContent).toContain("Retry atual");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("aborts history on unmount and keeps remount independent of pending replies", async () => {
  const net = controlledFetch(), signals: AbortSignal[] = [];
  vi.stubGlobal("fetch", (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal) signals.push(init.signal);
    return net.fetch(url, init);
  });
  const first = render(<UpdatePanel installedVersion="0.1.0"/>);
  fireEvent.click(screen.getByRole("button", { name: "Consultar releases públicas" }));
  first.unmount();
  expect(signals[0].aborted).toBe(true);
  render(<UpdatePanel installedVersion="0.1.0"/>);
  await act(async () => { net.calls[2].respond(200, reply("Nova montagem")); });
  await act(async () => { net.calls[0].respond(500, {}); net.calls[1].respond(503, { error: "Erro anterior" }); });
  expect(screen.getByRole("status").textContent).toContain("Nova montagem");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Consultar releases públicas" }).hasAttribute("disabled")).toBe(false);
});

it("StrictMode drops the first effect's history and keeps the active one", async () => {
  const net = controlledFetch(); vi.stubGlobal("fetch", net.fetch);
  render(<StrictMode><UpdatePanel installedVersion="0.1.0"/></StrictMode>);
  expect(net.calls).toHaveLength(2);
  await act(async () => { net.calls[1].respond(200, reply("Histórico ativo")); });
  await act(async () => { net.calls[0].respond(200, reply("Histórico cancelado")); });
  expect(screen.getByRole("status").textContent).toContain("Histórico ativo");
});
