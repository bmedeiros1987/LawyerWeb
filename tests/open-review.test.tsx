// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OpenReview } from "@/components/desktop/open-review";
import { DesktopOpenWatcher } from "@/components/desktop/open-watcher";
import { controlledFetch } from "./helpers/controlled-fetch";

const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: "/app" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }), usePathname: () => nav.pathname }));

const queue: string[][] = [];
beforeEach(() => {
  sessionStorage.clear(); nav.push.mockReset(); nav.pathname = "/app"; queue.length = 0;
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = { core: { invoke: vi.fn(async (cmd: string) => (cmd === "take_pending_opens" ? (queue.shift() ?? []) : null)) }, event: { listen: vi.fn(async () => () => {}) } };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (window as unknown as { __TAURI__?: unknown }).__TAURI__; });

const ok = { input: "/Users/a/Contrato.docx", ok: true, kind: "docx", path: "/Users/a/Contrato.docx", name: "Contrato.docx", size: 2048, sha256: "a".repeat(64), findings: [{ severity: "warn", code: "external-content", message: "Referencia 1 recurso externo." }] };
const bad = { input: "/Users/a/macro.docx", ok: false, kind: "docx", path: "/Users/a/macro.docx", name: "macro.docx", size: 4096, sha256: null, findings: [{ severity: "block", code: "macros", message: "O documento contém macros." }] };

it("checks files first and offers the import only for files that passed; blocked ones cannot be imported", async () => {
  queue.push([ok.input, bad.input]);
  const net = controlledFetch(); vi.stubGlobal("fetch", net.fetch);
  render(<OpenReview clients={[]} matters={[]} />);
  await act(async () => {});
  expect(net.calls[0].body).toEqual({ action: "assess", paths: [ok.input, bad.input] });
  expect(screen.getAllByText("Verificando o arquivo…").length).toBe(2);
  await act(async () => { net.calls[0].respond(200, { results: [ok, bad] }); });
  expect(screen.getByText(/Atenção: Referencia 1 recurso externo/)).toBeTruthy();
  expect(screen.getByText(/Bloqueado: O documento contém macros/)).toBeTruthy();
  const buttons = screen.getAllByRole("button", { name: "Importar uma cópia" }) as HTMLButtonElement[];
  expect(buttons.map(b => b.disabled)).toEqual([false, true]);
  expect(net.calls).toHaveLength(1); // nothing imported yet
  expect(screen.getByText(/não é alterado, movido nem apagado/)).toBeTruthy();
});

it("importing sends the exact path and SHA-256 that were shown, then confirms the copy", async () => {
  queue.push([ok.input]);
  const net = controlledFetch(); vi.stubGlobal("fetch", net.fetch);
  render(<OpenReview clients={[{ id: "c1", label: "Cliente fictício" }]} matters={[]} />);
  await act(async () => {}); await act(async () => { net.calls[0].respond(200, { results: [ok] }); });
  fireEvent.change(screen.getByLabelText(/Cliente \(opcional/), { target: { value: "c1" } });
  fireEvent.click(screen.getByRole("button", { name: "Importar uma cópia" }));
  expect(net.calls[1].body).toEqual({ action: "import", confirm: true, path: ok.path, sha256: ok.sha256, clientId: "c1", matterId: null, name: "Contrato" });
  await act(async () => { net.calls[1].respond(201, { documentId: "d9" }); });
  expect(screen.getByText(/Cópia importada. O original continua intacto/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Abrir o documento" }).getAttribute("href")).toBe("/app/documentos/d9");
  expect(sessionStorage.getItem("lawyermind.pending-open-files")).toBe("[]");
});

it("a refused import (file changed) stays on screen as an error and can be retried or dismissed", async () => {
  queue.push([ok.input]);
  const net = controlledFetch(); vi.stubGlobal("fetch", net.fetch);
  render(<OpenReview clients={[]} matters={[]} />);
  await act(async () => {}); await act(async () => { net.calls[0].respond(200, { results: [ok] }); });
  fireEvent.click(screen.getByRole("button", { name: "Importar uma cópia" }));
  await act(async () => { net.calls[1].respond(409, { error: "O arquivo mudou desde a verificação." }); });
  expect(screen.getByRole("alert").textContent).toContain("mudou desde a verificação");
  fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
  expect(screen.queryByText("Contrato.docx")).toBeNull();
  expect(screen.getByText("Nenhum arquivo aguardando")).toBeTruthy();
});

it("the watcher takes the queue once and sends the user to the review screen, only when something is waiting", async () => {
  render(<DesktopOpenWatcher />);
  await act(async () => {});
  expect(nav.push).not.toHaveBeenCalled();
  cleanup();
  queue.push(["/Users/a/Petição.pdf"]);
  render(<DesktopOpenWatcher />);
  await act(async () => {});
  expect(nav.push).toHaveBeenCalledWith("/app/documentos/abrir");
  expect(JSON.parse(sessionStorage.getItem("lawyermind.pending-open-files")!)).toEqual(["/Users/a/Petição.pdf"]);
  cleanup(); nav.push.mockReset(); nav.pathname = "/app/documentos/abrir";
  render(<DesktopOpenWatcher />);
  await act(async () => {});
  expect(nav.push).not.toHaveBeenCalled(); // already on the review screen
});
