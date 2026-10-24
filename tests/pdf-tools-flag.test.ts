import { expect, it } from "vitest";
import { PDF_TOOLS_FLAG, pdfToolsExperimentalEnabled } from "@/lib/pdf-tools/flag";

it("keeps the experimental PDF tools route off unless the flag is exactly 1", () => {
  expect(PDF_TOOLS_FLAG).toBe("LAWYERMIND_PDF_TOOLS_EXPERIMENTAL");
  expect(pdfToolsExperimentalEnabled({})).toBe(false);
  for (const value of ["", "0", "true", "yes", " 1", "1 ", "on"]) {
    expect(pdfToolsExperimentalEnabled({ [PDF_TOOLS_FLAG]: value })).toBe(false);
  }
  expect(pdfToolsExperimentalEnabled({ [PDF_TOOLS_FLAG]: "1" })).toBe(true);
});
