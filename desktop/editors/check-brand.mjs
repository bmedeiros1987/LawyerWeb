#!/usr/bin/env node
// Fails if an editor binary still carries community links or the upstream release endpoint.
// Allowed leftovers (not visible to the user, not a link): the stored preference key "showDiscord"
// of WordCraft, and the copyright line "ArtCraft Team and the ... contributors" that NOTICE requires.
// Usage: node check-brand.mjs <binary>...
import fs from "node:fs";

// "showDiscord" also appears split across machine-code immediates ("showDisc" + "wDiscord").
const allowed = [/showDiscord/g, /wDiscord/g];
const forbidden = [/discord/gi, /getartcraft/gi, /api\.github\.com\/repos\/storytold/gi, /github\.com\/storytold\/[a-z-]+\/releases/gi];
let failed = 0;
for (const file of process.argv.slice(2)) {
  let text = fs.readFileSync(file).toString("latin1");
  for (const re of allowed) text = text.replace(re, "");
  let bad = 0;
  for (const re of forbidden) {
    const hits = text.match(re) ?? [];
    if (hits.length) { bad += hits.length; console.error(`${file}: ${hits.length} × ${re.source}`); }
  }
  console.log(`${file}: ${bad === 0 ? "limpo" : "COM marca/atualizador"}`);
  if (bad) failed++;
}
process.exit(failed === 0 ? 0 : 1);
