// Guidance for choosing LawyerMind as the default app for PDF and DOCX through the operating system's OWN flow.
// LawyerMind never changes a default itself: no registry write, no UserChoice, no Launch Services call, no
// `duti`/`defaults`. On Windows it can only open the system "Default apps" page; on macOS it explains Apple's flow.
import { spawn } from "node:child_process";

export type DefaultAppsInfo = { platform: "windows" | "macos" | "linux"; canOpenSystemSettings: boolean; steps: string[]; legacyDocNote: string };

const LEGACY = "Arquivos .doc (Word 97-2003) não são associados ao LawyerMind: a compatibilidade não foi comprovada e nenhuma conversão sem perdas é prometida. Salve como .docx no Word.";

export function defaultAppsInfo(platform: NodeJS.Platform = process.platform): DefaultAppsInfo {
  if (platform === "win32") return {
    platform: "windows", canOpenSystemSettings: true, legacyDocNote: LEGACY,
    steps: [
      "Clique em \"Abrir configurações do Windows\" abaixo (Configurações › Aplicativos › Aplicativos padrão).",
      "Procure \"LawyerMind\" na lista. Se ele não aparecer, reinstale o aplicativo: o instalador o cadastra como opção.",
      "Em LawyerMind, escolha \".pdf\" e/ou \".docx\" e confirme no Windows. O Windows pode pedir sua confirmação.",
      "Para desfazer, volte à mesma tela e escolha outro aplicativo. O LawyerMind não altera essa escolha sozinho.",
    ],
  };
  if (platform === "darwin") return {
    platform: "macos", canOpenSystemSettings: false, legacyDocNote: LEGACY,
    steps: [
      "No Finder, selecione um arquivo PDF ou DOCX e use Arquivo › Obter Informações (⌘I).",
      "Em \"Abrir com\", escolha LawyerMind.",
      "Para valer para todos os arquivos desse tipo, clique em \"Alterar Tudo…\" e confirme. Repita para o outro tipo.",
      "Para desfazer, repita escolhendo outro aplicativo. O LawyerMind não altera essa escolha sozinho.",
    ],
  };
  return { platform: "linux", canOpenSystemSettings: false, legacyDocNote: LEGACY, steps: ["Esta versão não registra associações de arquivo no Linux."] };
}

/** Opens only the Windows "Default apps" page. Constant arguments, no shell. Returns whether a launch was attempted. */
export function openSystemSettings(platform: NodeJS.Platform = process.platform, run: typeof spawn = spawn): boolean {
  if (platform !== "win32") return false;
  if (process.env.MBLZ_DESKTOP_NO_LAUNCH === "1") return false; // packaged self-test: never launch programs
  const child = run(/*turbopackIgnore: true*/ "explorer.exe", ["ms-settings:defaultapps"], { detached: true, stdio: "ignore", shell: false });
  child.on("error", () => {});
  child.unref();
  return true;
}
