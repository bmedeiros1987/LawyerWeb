// Experimental PDF tools route gate. Off unless the operator sets the variable to exactly "1".
// No engine, upload, storage or AI is wired behind this flag; it only reveals an availability notice.
export const PDF_TOOLS_FLAG = "LAWYERMIND_PDF_TOOLS_EXPERIMENTAL";

export function pdfToolsExperimentalEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[PDF_TOOLS_FLAG] === "1";
}
