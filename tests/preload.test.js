// index.html preloads every module app.js imports (directly or not): without a build step the browser would
// otherwise find them one import level after another, a round trip each.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const ENTRY = "/js/app.js";

// Every module reachable from the entry, as site paths ("/js/dom.js").
function graph(entry) {
  const seen = new Set();
  const todo = [entry];
  while (todo.length) {
    const file = todo.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(path.join(PUBLIC, file), "utf8");
    for (const m of src.matchAll(/^\s*(?:import|export)\b[^"'`;]*?["'](\.{1,2}\/[^"']+)["']/gm)) {
      todo.push(path.posix.join(path.posix.dirname(file), m[1]));
    }
    for (const m of src.matchAll(/^\}\s*from\s*["'](\.{1,2}\/[^"']+)["']/gm)) {
      todo.push(path.posix.join(path.posix.dirname(file), m[1]));
    }
  }
  return seen;
}

test("index.html preloads the whole module graph of app.js", () => {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  assert.ok(html.includes(`<script type="module" src="${ENTRY}">`), "app.js is the entry");
  const preloaded = new Set([...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]));
  const wanted = graph(ENTRY);
  wanted.delete(ENTRY);
  assert.ok(wanted.size > 10, "the import graph was read");
  assert.deepEqual([...preloaded].sort(), [...wanted].sort());
});

test("index.html preloads the game data the way game.js fetches it", () => {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  // "crossorigin" makes the preload match fetch()'s default mode: without it the file is downloaded twice.
  assert.ok(html.includes('<link rel="preload" href="/data/game.json" as="fetch" crossorigin>'));
  assert.ok(fs.readFileSync(path.join(PUBLIC, "js/game.js"), "utf8").includes('fetch("/data/game.json"'));
});
