// @vitest-environment jsdom
// Search window: a previous query's hits are never shown (or opened with Enter)
// while a new query or filter is pending, and late answers are ignored.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { controlledFetch } from "./helpers/controlled-fetch";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
import { SearchDialog, openSearch } from "@/components/search/search-dialog";

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); push.mockReset(); });

const hit = (id: string, title: string, kind = "documents") => ({ kind, id, title, subtitle: "", href: `/app/${kind}/${id}` });
const answer = (hits: unknown[], query = "") => ({ query, hits, counts: {}, unavailable: {} });

async function setup() {
  const net = controlledFetch();
  vi.stubGlobal("fetch", net.fetch);
  render(<SearchDialog/>);
  act(() => openSearch());
  const input = screen.getByLabelText("Termo de busca");
  const type = (q: string) => fireEvent.change(input, { target: { value: q } });
  const enter = () => fireEvent.keyDown(input, { key: "Enter" });
  const callFor = async (n: number) => { await waitFor(() => expect(net.calls.length).toBe(n), { timeout: 2000 }); return net.calls[n - 1]; };
  const respond = (c: { respond: (s: number, j: unknown) => void }, json: unknown) => act(async () => { c.respond(200, json); await new Promise(r => setTimeout(r, 0)); });
  return { net, type, enter, callFor, respond };
}

describe("search window", () => {
  it("new query: old hits disappear at once, 'Buscando…' shows, Enter opens nothing until the answer", async () => {
    const t = await setup();
    t.type("horizonte");
    await t.respond(await t.callFor(1), answer([hit("c1", "Construtora Horizonte", "clients")]));
    expect(screen.getByText("Construtora Horizonte")).toBeTruthy();

    t.type("exclusividade"); // still inside the debounce window: no request yet
    expect(screen.queryByText("Construtora Horizonte")).toBeNull();
    expect(screen.getByText("Buscando…")).toBeTruthy();
    t.enter();
    expect(push).not.toHaveBeenCalled();

    const second = await t.callFor(2);
    expect(second.url).toContain("q=exclusividade");
    expect(screen.queryByText("Construtora Horizonte")).toBeNull(); // request in flight
    t.enter();
    expect(push).not.toHaveBeenCalled();

    await t.respond(second, answer([hit("d2", "Parecer de exclusividade")]));
    expect(screen.getByText("Parecer de exclusividade")).toBeTruthy();
    t.enter();
    expect(push).toHaveBeenCalledWith("/app/documents/d2");
  });

  it("answers out of order: the late answer to an older query is ignored", async () => {
    const t = await setup();
    t.type("mult");
    const older = await t.callFor(1);
    t.type("multa");
    const newer = await t.callFor(2);
    await t.respond(newer, answer([hit("n", "Cláusula de multa")]));
    await t.respond(older, answer([hit("o", "Resultado antigo de mult")]));
    expect(screen.getByText("Cláusula de multa")).toBeTruthy();
    expect(screen.queryByText("Resultado antigo de mult")).toBeNull();
  });

  it("changing the filter hides results of the other filter until its own answer", async () => {
    const t = await setup();
    t.type("horizonte");
    await t.respond(await t.callFor(1), answer([hit("d1", "Contrato Horizonte")]));
    fireEvent.click(screen.getByRole("button", { name: /^Clientes/ }));
    expect(screen.queryByText("Contrato Horizonte")).toBeNull();
    const byClient = await t.callFor(2);
    expect(byClient.url).toContain("kinds=clients");
    await t.respond(byClient, answer([hit("c1", "Construtora Horizonte", "clients")]));
    expect(screen.getByText("Construtora Horizonte")).toBeTruthy();
  });

  it("going back to the same query does not reuse an answer that belongs to another one", async () => {
    const t = await setup();
    t.type("alpha");
    await t.respond(await t.callFor(1), answer([hit("a", "Documento alpha")]));
    t.type("alphabeta");
    t.type("alpha"); // back to the shown query before any new answer
    expect(screen.getByText("Documento alpha")).toBeTruthy(); // same key: still the right answer
    t.type("beta");
    expect(screen.queryByText("Documento alpha")).toBeNull();
  });
});
