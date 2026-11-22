// Downloads the game data the live site serves into public/data and public/img, for a deploy from a clean
// checkout (CI). The data is not in git: Tools/dwarfbuilds_export.py in the mod repository reads it from an
// installed game, and a local `npm run deploy` publishes it. Every image game.json refers to is fetched.
//   node scripts/fetch-game-data.mjs [site]     (default https://dwarfbuilds.pages.dev)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = (process.argv[2] || "https://dwarfbuilds.pages.dev").replace(/\/$/, "");

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 3) throw new Error(`${url}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

function save(rel, data) {
  const file = path.join(WEB, "public", rel);
  if (!file.startsWith(path.join(WEB, "public") + path.sep)) throw new Error(`bad path ${rel}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

const json = await get(`${SITE}/data/game.json`);
const game = JSON.parse(json.toString("utf8"));
if (!game.version || !Array.isArray(game.classes)) throw new Error("game.json has no version or classes");
save("data/game.json", json);

const images = [...new Set(json.toString("utf8").match(/img\/[A-Za-z0-9_./-]+\.(?:png|jpg|webp|svg)/g) || [])];
if (images.some((p) => p.includes(".."))) throw new Error("game.json refers to a path outside img/");
let done = 0;
const queue = [...images];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const rel = queue.shift();
    save(rel, await get(`${SITE}/${rel}`));
    done++;
  }
}));
console.log(`game data ${game.version}: game.json and ${done} images from ${SITE}`);
