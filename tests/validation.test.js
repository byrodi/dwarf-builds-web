import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cleanText, csrfProblem, safeNext, isLocalHost, readJson, HttpError } from "../functions/_lib/http.js";
import { newId, isBuildId, likePattern, parseBuildBody, parsePage, currentCode } from "../functions/_lib/builds.js";
import { ogTags, escapeHtml, onRequestGet as ogHandler } from "../functions/b/[id].js";
import { clearGameDataCache } from "../functions/_lib/gamedata.js";

const game = JSON.parse(fs.readFileSync(new URL("./fixtures/game.sample.json", import.meta.url), "utf8"));
const CODE = "DB2:D:1-21321-4:2-12213-0:1-3112-0:1-2121-0:1-2112-0:3--0:1-12-0:2.3.5.4.8.34";

test("csrf guard", () => {
  const mk = (h) => new Request("https://dwarfbuilds.pages.dev/api/builds", { method: "POST", headers: h });
  const good = { "Content-Type": "application/json", "X-Dwarfbuilds": "1", Origin: "https://dwarfbuilds.pages.dev" };
  assert.equal(csrfProblem(mk(good)), null);
  assert.ok(csrfProblem(mk({ ...good, "Content-Type": "text/plain" })));
  assert.ok(csrfProblem(mk({ ...good, "Content-Type": "application/x-www-form-urlencoded" })));
  assert.ok(csrfProblem(mk({ ...good, "X-Dwarfbuilds": "0" })));
  assert.ok(csrfProblem(mk({ ...good, Origin: "https://evil.example" })));
  assert.ok(csrfProblem(mk({ ...good, Origin: "null" })));
  const noOrigin = { ...good };
  delete noOrigin.Origin;
  assert.ok(csrfProblem(mk(noOrigin)));
});

test("text cleaning and limits", () => {
  assert.equal(cleanText("  Hello\tworld‮ ", { max: 80 }), "Hello world");
  assert.equal(cleanText("a\r\nb\n\n\n\n\nc\u0007", { max: 100, multiline: true }), "a\nb\n\n\nc");
  // Tabs stay in multiline text (Markdown lists and code), so the editor preview matches what is saved.
  assert.equal(cleanText("- a\n\t- b\n-\tc", { max: 100, multiline: true }), "- a\n\t- b\n-\tc");
  assert.throws(() => cleanText("", { max: 80, required: true }), HttpError);
  assert.throws(() => cleanText("x".repeat(81), { max: 80 }), /longer than 80/);
  assert.equal(cleanText("\u{1F600}".repeat(80), { max: 80 }).length, 160, "counts code points");
  assert.throws(() => cleanText(5, { max: 80 }), HttpError);
  assert.equal(cleanText(undefined, { max: 10 }), "");
});

test("safe next path", () => {
  assert.equal(safeNext("/b/abc?x=1"), "/b/abc?x=1");
  for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "evil", "", null, "/a\nb"]) {
    assert.equal(safeNext(bad), "/", String(bad));
  }
});

test("local host check", () => {
  assert.ok(isLocalHost("http://localhost:8788/api/auth/dev"));
  assert.ok(isLocalHost("http://127.0.0.1:8788/"));
  assert.ok(!isLocalHost("https://dwarfbuilds.pages.dev/"));
  assert.ok(!isLocalHost("https://localhost.evil.example/"));
});

test("json body", async () => {
  const mk = (body, h = {}) => new Request("https://x.test/", { method: "POST", body, headers: h });
  assert.deepEqual(await readJson(mk('{"a":1}')), { a: 1 });
  await assert.rejects(readJson(mk("[1]")), /JSON object/);
  await assert.rejects(readJson(mk("{bad")), /JSON object/);
  await assert.rejects(readJson(mk("x".repeat(20000))), /too large/);
});

test("ids", () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const id = newId();
    assert.ok(isBuildId(id), id);
    seen.add(id);
  }
  assert.equal(seen.size, 2000);
  assert.ok(!isBuildId("abc"));
  assert.ok(!isBuildId("abcdefg!"));
});

test("LIKE escaping and paging", () => {
  assert.equal(likePattern("100%_a\\b"), "%100\\%\\_a\\\\b%");
  assert.equal(parsePage("x"), 1);
  assert.equal(parsePage("-3"), 1);
  assert.equal(parsePage("5"), 5);
  assert.equal(parsePage("999999"), 50);
});

test("build body", () => {
  const b = parseBuildBody({ title: " My  build ", description: "line1\nline2", code: CODE }, game);
  assert.equal(b.title, "My build");
  assert.equal(b.code, CODE);
  assert.equal(b.class, "D");
  assert.equal(b.primaryItem, "FlameThrower");
  assert.equal(b.secondaryItem, "ChargeBlaster");
  assert.match(b.primaryOc, /^OC_/);
  assert.equal(b.secondaryOc, null);
  assert.equal(b.dataVersion, game.version);
  assert.equal(JSON.parse(b.buildJson).class, "D");
  assert.throws(() => parseBuildBody({ title: "", code: CODE }, game), /title is required/);
  assert.throws(() => parseBuildBody({ title: "t", code: "nope" }, game), /invalid build/);
  assert.throws(() => parseBuildBody({ title: "t" }, game), /code is required/);
  assert.throws(() => parseBuildBody({ title: "fuck you", code: CODE }, game), /title has a word that is not allowed: "fuck"/);
  assert.throws(() => parseBuildBody({ title: "t", code: CODE, description: "ok\nполный пиздец" }, game), /description has a word/);
  assert.throws(() => parseBuildBody({ title: "t", code: CODE, description: "x".repeat(4001) }, game), /4000/);
  assert.throws(() => parseBuildBody({ title: "t", code: CODE.replace(/:[^:]*$/, ":1.4.8") }, game), /too many active/);
});

test("current code is rebuilt after a data update", () => {
  const b = parseBuildBody({ title: "t", code: CODE }, game);
  const row = { code: b.code, build_json: b.buildJson, data_version: b.dataVersion };
  assert.deepEqual(currentCode(row, game), { code: CODE, rebuilt: false, missing: [] });
  const g2 = JSON.parse(JSON.stringify(game));
  g2.version = "next";
  const d = g2.classes.find((c) => c.letter === "D");
  d.slots.primary.reverse();
  d.slots.primary.forEach((it, i) => (it.index = i + 1));
  const cur = currentCode(row, g2);
  assert.equal(cur.rebuilt, true);
  assert.match(cur.code, /^DB2:D:2-21321-4:/);
});

test("open graph tags are escaped", () => {
  const t = ogTags({ title: `"><script>x</script>`, description: "a & b", url: "https://x.test/b/1" });
  assert.ok(!t.includes("<script>"));
  assert.ok(t.includes("&quot;&gt;&lt;script&gt;"));
  assert.ok(t.includes("a &amp; b"));
  assert.equal(escapeHtml(`'`), "&#39;");
});

test("open graph function", async () => {
  clearGameDataCache();
  const html = "<html><head><!--og--><title>Dwarf Builds</title></head><body></body></html>";
  const assets = {
    fetch: async (url) => {
      const p = new URL(url).pathname;
      if (p === "/index.html") return new Response(html, { headers: { "Content-Type": "text/html" } });
      if (p === "/data/game.json") return Response.json(game);
      return new Response("nf", { status: 404 });
    },
  };
  const row = { id: "Ab3dE5gH", class: "D", title: 'Fire <"build">', description: "Burn them.", code: CODE, hidden: 0, banned: 0, author_name: "Karl", user_id: "76561197960287930" };
  const db = (r) => ({ prepare: () => ({ bind: () => ({ first: async () => r }) }) });
  const ctx = (id, r) => ({
    request: new Request(`https://dwarfbuilds.pages.dev/b/${id}`),
    env: { ASSETS: assets, DB: db(r) },
    params: { id },
    next: async () => new Response("next"),
  });
  const res = await ogHandler(ctx("Ab3dE5gH", row));
  const text = await res.text();
  assert.match(text, /<meta property="og:title" content="Fire &lt;&quot;build&quot;&gt;">/);
  assert.match(text, /og:description" content="Driller - CRSPR Flamethrower \/ [^"]+\. by Karl\. Burn them\."/);
  assert.match(text, /og:url" content="https:\/\/dwarfbuilds.pages.dev\/b\/Ab3dE5gH"/);
  assert.match(text, /og:image" content="https:\/\/dwarfbuilds.pages.dev\/img\/class\/driller_portrait.png"/);
  assert.ok(!text.includes("<!--og-->"));

  for (const [id, r] of [["Ab3dE5gH", null], ["Ab3dE5gH", { ...row, hidden: 1 }], ["bad", row]]) {
    const t = await (await ogHandler(ctx(id, r))).text();
    assert.equal(t, html, "passes through unchanged");
  }
  const broken = ctx("Ab3dE5gH", row);
  broken.env.DB = { prepare: () => { throw new Error("db down"); } };
  assert.equal(await (await ogHandler(broken)).text(), html);

  // "$'" / "$`" / "$&" in user text are plain text, not String.replace patterns.
  const dollar = await (await ogHandler(ctx("Ab3dE5gH", { ...row, title: "a$'b$`c$&d", description: "$$" }))).text();
  assert.match(dollar, /og:title" content="a\$&#39;b\$`c\$&amp;d"/);
  assert.equal(dollar.split("<title>").length, 2, "page parts are not copied in");
  assert.ok(dollar.includes("$$"));
});
