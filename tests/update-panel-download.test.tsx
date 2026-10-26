// @vitest-environment jsdom
// Download confirmation of the update panel. Complements update-panel.test.tsx (race fixes) without changing it.
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UpdatePanel } from "@/components/desktop/update-panel";
import { controlledFetch } from "./helpers/controlled-fetch";
import { initialReleaseState } from "@/lib/desktop/release-check";
import { packageFor } from "@/lib/desktop/update-manifest";
import { manifestFor } from "./helpers/update-fixture";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const pkg = packageFor(manifestFor(["darwin-aarch64"]), "darwin-aarch64")!;
const available = { ...initialReleaseState("1.0.0"), status: "update-available" as const, latestVersion: "v2.0.0", package: pkg, target: pkg.target, message: "Há release." };

it("offers no download unless a verified-contract update exists", async () => {
  const net = controlledFetch(); vi.stubGlobal("fetch", net.fetch);
  render(<UpdatePanel installedVersion="1.0.0"/>);
  await act(async () => { net.calls[0].respond(200, { ...initialReleaseState("1.0.0"), status: "release-unverified", message: "Sem manifesto." }); });
  expect(screen.queryByRole("button", { name: /Baixar/ })).toBeNull();
  expect(screen.getByText(/Nenhum instalador é baixado ou executado/)).toBeTruthy();
});

it("sends a confirmation bound to the exact version and hash, and reports a refusal", async () => {
  const net = controlledFetch(); vi.stubGlobal("fetch", net.fetch);
  render(<UpdatePanel installedVersion="1.0.0"/>);
  await act(async () => { net.calls[0].respond(200, available); });
  expect(screen.getByText(pkg.sha256)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Baixar e verificar (não instala)" }));
  expect(net.calls[1].body).toEqual({ action: "download", confirm: true, version: "v2.0.0", sha256: pkg.sha256 });
  await act(async () => { net.calls[1].respond(503, { error: "Chave pública de atualização não configurada." }); });
  expect(screen.getByRole("alert").textContent).toContain("não configurada");
  expect(screen.queryByText(/Baixado e verificado/)).toBeNull();
});
