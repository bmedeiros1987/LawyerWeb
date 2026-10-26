// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DocumentAssistant } from "@/components/document-ai/assistant";
import { controlledFetch } from "./helpers/controlled-fetch";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const text = "CLÁUSULA 2. A rescisão exige aviso de 10 dias.";
const win = { offset: 0, length: text.length, text, max: 6000 };
const off = { id: "none", label: "Nenhum provedor de IA conectado", state: "unavailable", reason: "Nenhum provedor foi conectado. Nenhum trecho é enviado.", sendsDataOutsideDevice: false };
const on = { id: "double", label: "Duplo de teste", state: "available", reason: "ok", sendsDataOutsideDevice: true };
const setup = async (provider: object) => {
  const net = controlledFetch(); vi.stubGlobal("fetch", net.fetch);
  render(<DocumentAssistant documentId="d1" versionId="v1" label="Contrato fictício · versão 1" />);
  await act(async () => { net.calls[0].respond(200, { provider, window: win }); });
  return net;
};
const select = (start: number, end: number) => { const a = screen.getByLabelText("Texto do documento") as HTMLTextAreaElement; a.setSelectionRange(start, end); fireEvent.select(a); };

it("with no provider the form is disabled and no answer, simulated or not, is ever shown", async () => {
  const net = await setup(off);
  expect(screen.getByRole("status").textContent).toContain("Nenhum trecho é enviado");
  select(12, 30);
  expect((screen.getByRole("button", { name: "Perguntar" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("Pergunta sobre o trecho") as HTMLTextAreaElement).disabled).toBe(true);
  expect(net.calls).toHaveLength(1);
  expect(screen.queryByText(/Sugestão da IA/)).toBeNull();
});

it("sends only the selected offsets and a consent, then shows source, suggestion and uncertainty apart", async () => {
  const net = await setup(on);
  select(12, 40);
  fireEvent.change(screen.getByLabelText("Pergunta sobre o trecho"), { target: { value: "O que diz?" } });
  expect((screen.getByRole("button", { name: "Perguntar" }) as HTMLButtonElement).disabled).toBe(true); // no consent yet
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("checkbox").parentElement?.textContent).toContain("fora deste computador");
  fireEvent.click(screen.getByRole("button", { name: "Perguntar" }));
  expect(net.calls[1].body).toEqual({ versionId: "v1", start: 12, end: 40, question: "O que diz?", consent: true });
  await act(async () => { net.calls[1].respond(200, { status: "answer", provider: on, notice: "Sugestão automática: não é aconselhamento jurídico.",
    source: { documentId: "d1", versionId: "v1", start: 12, end: 40, excerptSha256: "x" }, sources: { verified: [{ quote: "A rescisão exige", start: 13, end: 29 }], unverifiedCount: 1 },
    suggestion: { answer: "Exige aviso.", suggestions: [{ kind: "replace", quote: "A rescisão exige", replacement: "A rescisão depende de", reason: "Alternativa", anchor: { start: 13, end: 29, excerptSha256: "x" }, applied: false }], applied: false },
    uncertainty: { level: "medium", notes: ["Sem lei citada."] } }); });
  expect(screen.getByText("Fonte verificada no trecho")).toBeTruthy();
  expect(screen.getByText("Sugestão da IA · não aplicada")).toBeTruthy();
  expect(screen.getByText("Incerteza: média")).toBeTruthy();
  expect(screen.getByText(/nada foi aplicado/)).toBeTruthy();
  expect(screen.getByText(/1 item\(ns\) do provedor descartado/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /aplicar|enviar|aceitar/i })).toBeNull(); // copy only
});

it("shows an unavailable/failed consultation as an error, not as an answer", async () => {
  const net = await setup(on);
  select(0, 10); fireEvent.change(screen.getByLabelText("Pergunta sobre o trecho"), { target: { value: "x" } }); fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Perguntar" }));
  await act(async () => { net.calls[1].respond(503, { error: "Nenhum provedor foi conectado.", code: "provider-unavailable" }); });
  expect(screen.getByRole("alert").textContent).toContain("Nenhum provedor foi conectado");
  expect(screen.queryByText("Sugestão da IA · não aplicada")).toBeNull();
});
