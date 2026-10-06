#!/usr/bin/env node
// Copies the web app's visual system (globals.css, fonts, brand) into the
// desktop UI so both share the same interface. Generated files are gitignored;
// the web app is the single source of truth.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(desktop, "..");
const ui = path.join(desktop, "ui");

fs.copyFileSync(path.join(repo, "app", "globals.css"), path.join(ui, "app", "mblz-globals.css"));
for (const dir of ["fonts", "brand"]) {
  fs.rmSync(path.join(ui, "public", dir), { recursive: true, force: true });
  fs.cpSync(path.join(repo, "public", dir), path.join(ui, "public", dir), { recursive: true });
}
console.log("UI: globals.css, fonts e brand sincronizados a partir do app web.");
