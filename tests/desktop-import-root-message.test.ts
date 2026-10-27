import { describe, expect, it } from "vitest";
import { alreadyWorkingCopyMessage, isInside } from "@/lib/desktop/paths";

describe("mensagem de arquivo dentro da pasta de cópias", () => {
  it("nomeia a pasta de cópias e o arquivo, e manda conferir em Computador", () => {
    const msg = alreadyWorkingCopyMessage("/dados/documentos", "/dados/documentos/Downloads/a.pdf");
    expect(msg).toContain("/dados/documentos");
    expect(msg).toContain("/dados/documentos/Downloads/a.pdf");
    expect(msg).toContain("Computador");
    expect(msg).not.toMatch(/^Este arquivo já é uma cópia de trabalho do LawyerMind\.$/);
  });
  it("uma pasta de cópias vizinha de Downloads não engloba o arquivo", () => {
    expect(isInside("/home/u/AppData/documentos", "/home/u/Downloads/a.pdf")).toBe(false);
  });
  it("uma raiz que é ancestral de Downloads engloba tudo (o caso que a mensagem precisa expor)", () => {
    expect(isInside("/home/u", "/home/u/Downloads/a.pdf")).toBe(true);
  });
});
