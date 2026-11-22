// Writes tests/code_vectors.json: {code, build} pairs over tests/fixtures/game.sample.json.
// "code" is the canonical code, "build" the parsed build object (perks as ids).
// Entries with "input" give a non-canonical code that must read as "build" and re-encode as "code".
//   node scripts/make-vectors.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCode, validateBuild } from "../public/js/shared/code.js";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const game = JSON.parse(fs.readFileSync(path.join(WEB, "tests/fixtures/game.sample.json"), "utf8"));

const cases = [
  ["full Driller build", "DB1:D:1-21321-4:2-12213-0:1-3112-0:1-2121-0:1-2112-0:3--0:2.3.5.4.8.34"],
  ["full Scout build", "DB1:S:2-21221-3:1-12213-1:1-2122-0:1-212-0:1-3113-0:2--0:3.7.13.17.22.36"],
  ["primary only", "DB1:S:1-00000-0:0--0:0--0:0--0:0--0:0--0:"],
  ["grenade only", "DB1:D:0--0:0--0:0--0:0--0:0--0:1--0:"],
  ["partial tiers, no OC", "DB1:D:2-10200-0:1-00003-2:0--0:0--0:0--0:0--0:"],
  ["proficiency only", "DB1:S:1-11111-0:0--0:0--0:0--0:0--0:0--0:35"],
  ["two passive, one active", "DB1:D:1-22222-1:0--0:0--0:0--0:0--0:0--0:2.3.1"],
];

const nonCanonical = [
  ["perks out of order", "DB1:D:1-21321-4:2-12213-0:1-3112-0:1-2121-0:1-2112-0:3--0:34.4.2.8.3.5"],
  ["extra tier digits and extra parts", "DB1:D:1-213219-4-7:2-12213-0:1-3112-0:1-2121-0:1-2112-0:3-5-0:2.3.5.4.8.34:EXTRA:9"],
  ["missing tier digits and parts", "DB1:S:2-21-3:1"],
  ["lower case and spaces", "  db1:s:2-21221-3:1-12213-1:0--0:0--0:0--0:0--0:3.7  "],
  ["empty fields", "DB1:D:1::::::"],
];

const out = [];
for (const [note, code] of cases) {
  const v = validateBuild(code, game);
  if (!v.ok) throw new Error(`${note}: ${v.errors.join("; ")}`);
  if (v.canonical !== code) throw new Error(`${note}: not canonical, got ${v.canonical}`);
  out.push({ note, code, build: parseCode(code) });
}
for (const [note, input] of nonCanonical) {
  const v = validateBuild(input, game);
  if (!v.ok) throw new Error(`${note}: ${v.errors.join("; ")}`);
  if (v.canonical === input) throw new Error(`${note}: already canonical`);
  out.push({ note, input, code: v.canonical, build: v.build });
}
// One slot per line: number arrays and slot objects are kept on one line.
const text = JSON.stringify(out, null, 2)
  .replace(/\[\s+([0-9,\s]*?)\s+\]/g, (_, s) => `[${s.replace(/\s+/g, "")}]`)
  .replace(/\[\s*\]/g, "[]")
  .replace(/\{\s+("item": [^{}]*?)\s+\}/g, (_, s) => `{ ${s.replace(/\s*\n\s*/g, " ")} }`);
fs.writeFileSync(path.join(WEB, "tests/code_vectors.json"), text + "\n");
console.log(`wrote ${out.length} vectors`);
