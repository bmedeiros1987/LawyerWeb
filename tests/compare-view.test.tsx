// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CompareView } from "@/components/compare/compare-view";
import { compareTexts } from "@/lib/compare/compare";
import { controlledFetch } from "./helpers/controlled-fetch";

const L = "CLÁUSULA 1. Pagamento em R$ 10.000,00.\nCLÁUSULA 2. Aviso de 60 dias.\nCLÁUSULA 3. Foro de São Paulo.";
const R = "CLÁUSULA 1. Pagamento em R$ 12.000,00.\nCLÁUSULA 2. Aviso de 60 dias.\nCLÁUSULA 3. Foro de São Paulo.\nCLÁUSULA 4. Sigilo entre as partes.";
const payload = () => ({ left: { versionId: "v1", documentId: "d1", documentName: "Contrato fictício", version: 1, originalName: "c1.docx", fileSha256: "a".repeat(64) }, right: { versionId: "v2", documentId: "d1", documentName: "Contrato fictício", version: 2, originalName: "c2.docx", fileSha256: "b".repeat(64) }, result: compareTexts(L, R), ai: { state: "unavailable", label: "Nenhum provedor", reason: "Nenhum provedor de IA foi conectado." } });

const posted: unknown[] = [];
class FakeChannel { static all: FakeChannel[] = []; onmessage: ((e: { data: unknown }) => void) | null = null; constructor(public name: string) { FakeChannel.all.push(this); } postMessage(m: unknown) { posted.push(m); } close() {} }
let invoke: ReturnType<typeof vi.fn>;
beforeEach(() => { posted.length = 0; FakeChannel.all = []; vi.stubGlobal("BroadcastChannel", FakeChannel); invoke = vi.fn(async () => "doc-1"); (window as unknown as { __TAURI__: unknown }).__TAURI__ = { core: { invoke } }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (window as unknown as { __TAURI__?: unknown }).__TAURI__; });

async function mount(pane: "ambos" | "esq" | "dir" = "ambos") {
  const net = controlledFetch(); vi.stubGlobal("fetch", net.fetch);
  render(<CompareView left="v1" right="v2" pane={pane} />);
  await act(async () => { net.calls[0].respond(200, { versions: [{ id: "v1", documentId: "d1", label: "Contrato · versão 1" }, { id: "v2", documentId: "d1", label: "Contrato · versão 2" }] }); });
  await act(async () => { net.calls[1].respond(200, payload()); });
  return net;
}

it("shows both texts side by side, the local/no-AI statement, and observations tied to exact quotes", async () => {
  const net = await mount();
  expect(net.calls[1].body).toEqual({ leftVersionId: "v1", rightVersionId: "v2" });
  expect(screen.getByText(/Nada é enviado a IA ou à internet e nada é alterado/)).toBeTruthy();
  expect(screen.getAllByLabelText(/^Esquerda, parágrafo/).length).toBeGreaterThan(0); expect(screen.getAllByLabelText(/^Direita, parágrafo/).length).toBeGreaterThan(0);
  const list = screen.getByLabelText("Observações");
  const btn = within(list).getByRole("button", { name: /Valor\/prazo\/data alterado.*R\$ 10\.000,00.*R\$ 12\.000,00/ });
  fireEvent.click(btn);
  expect(within(list).getByText(/O que conferir:/)).toBeTruthy();
  const quotes = [...list.querySelectorAll("blockquote")].map(b => b.textContent);
  expect(quotes.some(q => q?.includes("R$ 10.000,00") && q.includes("Esquerda"))).toBe(true);
  expect(quotes.some(q => q?.includes("R$ 12.000,00") && q.includes("Direita"))).toBe(true);
  expect(within(list).getByRole("button", { name: /Incluído Trecho incluído/ })).toBeTruthy();
});

it("offers no way to apply, accept, save or send anything", async () => {
  await mount();
  expect(screen.queryByRole("button", { name: /aplicar|aceitar|salvar|enviar|substituir/i })).toBeNull();
  expect(screen.getByText(/Resumo por IA: indisponível/)).toBeTruthy();
});

it("a single-pane window renders only its side", async () => {
  await mount("dir");
  expect(screen.queryAllByLabelText(/^Esquerda, parágrafo/)).toHaveLength(0);
  expect(screen.getAllByLabelText(/^Direita, parágrafo/).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Abrir em duas janelas" })).toBeNull();
});

it("'two windows' asks the shell for one window per pane, with the exact allow-listed paths, leaving this window alone", async () => {
  await mount();
  const before = window.location.href;
  fireEvent.click(screen.getByRole("button", { name: "Abrir em duas janelas" }));
  await act(async () => {});
  expect(invoke.mock.calls).toEqual([["open_document_window", { path: "/app/documentos/comparar?esq=v1&dir=v2&painel=esq" }], ["open_document_window", { path: "/app/documentos/comparar?esq=v1&dir=v2&painel=dir" }]]);
  expect(window.location.href).toBe(before);
  expect(screen.getAllByLabelText(/^Esquerda, parágrafo/).length).toBeGreaterThan(0); // content still on screen
});

it("a refused window (limit reached) is shown as an error, the comparison stays", async () => {
  await mount();
  invoke.mockRejectedValueOnce("Já há 4 janelas extras abertas. Feche uma para abrir outra.");
  fireEvent.click(screen.getByRole("button", { name: "Esquerda em outra janela" }));
  await act(async () => {});
  expect(screen.getByRole("alert").textContent).toMatch(/Já há|Não foi possível/);
  expect(screen.getByLabelText("Observações")).toBeTruthy();
});

it("synchronised scrolling is off by default: selecting an observation sends nothing between windows", async () => {
  await mount();
  const list = screen.getByLabelText("Observações");
  expect((screen.getByLabelText(/Rolagem sincronizada/) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(within(list).getAllByRole("button")[0]);
  expect(posted).toEqual([]);
});

it("with synchronisation on, only an observation id is broadcast (never text) and the channel is named after the two versions", async () => {
  await mount();
  fireEvent.click(screen.getByLabelText(/Rolagem sincronizada/));
  fireEvent.click(within(screen.getByLabelText("Observações")).getAllByRole("button")[0]);
  expect(FakeChannel.all.at(-1)!.name).toBe("lawyermind-compare:v1:v2");
  expect(posted).toHaveLength(1);
  expect(Object.keys(posted[0] as object).sort()).toEqual(["from", "id", "t"]);
  expect(JSON.stringify(posted[0])).not.toMatch(/Pagamento|10\.000/);
});

it("an honest message for texts that cannot be compared", async () => {
  const net = controlledFetch(); vi.stubGlobal("fetch", net.fetch);
  render(<CompareView left="v1" right="v2" pane="ambos" />);
  await act(async () => { net.calls[0].respond(200, { versions: [] }); });
  await act(async () => { net.calls[1].respond(200, { ...payload(), result: { status: "too-large", message: "Texto grande demais. Compare por partes." } }); });
  expect(screen.getByRole("alert").textContent).toContain("Compare por partes");
  expect(screen.queryByLabelText("Observações")).toBeNull();
});

it("the API refusing a version (no permission / not found) is shown, never a partial comparison", async () => {
  const net = controlledFetch(); vi.stubGlobal("fetch", net.fetch);
  render(<CompareView left="v1" right="secreto" pane="ambos" />);
  await act(async () => { net.calls[0].respond(200, { versions: [] }); });
  await act(async () => { net.calls[1].respond(404, { error: "Documento não encontrado." }); });
  expect(screen.getByRole("alert").textContent).toContain("Documento não encontrado");
  expect(screen.queryByLabelText("Observações")).toBeNull();
});
