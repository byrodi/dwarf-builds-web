// Ranking of the build list: HOT (the default), NEW, TOP of a period; likes keep builds.hot; no like on your own build.

import test from "node:test";
import assert from "node:assert/strict";
import { makeD1 } from "./d1.js";
import { hotScore, HOT_DAYS } from "../functions/_lib/builds.js";
import { onRequestGet as listBuilds } from "../functions/api/builds/index.js";
import { onRequestPost as like } from "../functions/api/builds/[id]/like.js";

const OWNER = "76561197960287930";
const FAN = "76561197960287931";
const DAY = 86400000;
const NOW = Date.now();

function seed(db, builds) {
  const user = db.raw.prepare("INSERT INTO users (steam_id, name, avatar, created_at, updated_at, banned) VALUES (?, 'u', NULL, 0, 0, 0)");
  user.run(OWNER);
  user.run(FAN);
  const build = db.raw.prepare(
    `INSERT INTO builds (id, user_id, class, title, description, code, build_json, likes, hidden, created_at, updated_at, hot)
     VALUES (?, ?, 'D', 't', '', 'DB1:D:1--0:0--0:0--0:0--0:0--0:0--0:0--0:', '{}', 0, 0, ?, ?, ?)`
  );
  const liked = db.raw.prepare("INSERT INTO likes (build_id, user_id, created_at) VALUES (?, ?, ?)");
  const hot = db.raw.prepare("UPDATE builds SET hot = ? WHERE id = ?");
  for (const b of builds) {
    const created = NOW - b.age * DAY;
    build.run(b.id, OWNER, created, created, hotScore(0, created));
    // likes: days ago of each like (the trigger counts them)
    (b.likes || []).forEach((ago, i) => liked.run(b.id, `7656119796030${String(i).padStart(4, "0")}`, NOW - ago * DAY));
    hot.run(hotScore((b.likes || []).length, created), b.id);
  }
}

async function list(db, query = "") {
  const res = await listBuilds({ request: new Request(`https://dwarfbuilds.pages.dev/api/builds${query}`), env: { DB: db } });
  return res.json();
}

const ids = (data) => data.builds.map((b) => b.id).join(" ");

test("hot score: a build HOT_DAYS newer needs ten times fewer likes", () => {
  const older = hotScore(9, 0);
  const newer = hotScore(0, HOT_DAYS * DAY);
  assert.ok(Math.abs(older - newer) < 1e-9);
  assert.ok(hotScore(10, 0) > newer);
  assert.equal(hotScore(-3, 0), 0);
});

test("list: hot is the default and lets new builds pass old liked ones", async () => {
  const db = makeD1();
  seed(db, [
    { id: "oldstar0", age: 60, likes: Array(50).fill(50) }, // 50 likes long ago
    { id: "fresh000", age: 1 },                               // new, no likes
    { id: "risingup", age: 5, likes: [4, 4, 3, 3, 2, 2, 1, 1, 1] }, // 9 likes this week
  ]);
  const hot = await list(db);
  assert.equal(hot.sort, "hot");
  assert.equal(hot.period, null);
  assert.equal(ids(hot), "risingup fresh000 oldstar0");
  assert.equal((await list(db, "?sort=nonsense")).sort, "hot");
  assert.equal(ids(await list(db, "?sort=new")), "fresh000 risingup oldstar0");
  const plan = db.plans.find((x) => /ORDER BY b\.hot DESC/.test(x.sql));
  assert.match(plan.plan, /builds_hidden_hot/, plan.plan);
  assert.doesNotMatch(plan.plan, /TEMP B-TREE/, plan.plan);
});

test("list: top counts the likes of the period", async () => {
  const db = makeD1();
  seed(db, [
    { id: "oldstar0", age: 60, likes: Array(50).fill(50) },
    { id: "fresh000", age: 1 },
    { id: "risingup", age: 5, likes: [4, 4, 3] },
    { id: "lastmon0", age: 40, likes: [20, 20, 20, 20, 2] }, // 4 likes this month, 1 this week
  ]);
  const month = await list(db, "?sort=top");
  assert.equal(month.period, "month", "month is the default period");
  assert.equal(ids(month), "lastmon0 risingup", "only builds liked in the period, most likes first");
  assert.equal(ids(await list(db, "?sort=top&period=week")), "risingup lastmon0");
  assert.equal(ids(await list(db, "?sort=top&period=all")), "oldstar0 lastmon0 risingup fresh000");
  assert.equal((await list(db, "?sort=top&period=year")).period, "month");
  assert.equal(month.builds[0].likes, 5, "the card shows all likes");
  const plan = db.plans.find((x) => x.sql.includes("FROM likes INDEXED BY"));
  assert.match(plan.plan, /likes_created_build/, plan.plan);
  assert.doesNotMatch(plan.plan, /SCAN (b|likes)/, plan.plan);
});

test("like: not on your own build; a like moves the build up in hot", async () => {
  const db = makeD1();
  seed(db, [{ id: "minemine", age: 3 }, { id: "newer000", age: 1 }]);
  const env = { DB: db };
  const mine = await like({ env, params: { id: "minemine" }, data: { user: { steamId: OWNER } } });
  assert.equal(mine.status, 400);
  assert.match((await mine.json()).error, /your own build/);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM likes").get().n, 0);

  assert.equal(ids(await list(db)), "newer000 minemine");
  const before = db.raw.prepare("SELECT hot FROM builds WHERE id = 'minemine'").get().hot;
  const res = await (await like({ env, params: { id: "minemine" }, data: { user: { steamId: FAN } } })).json();
  assert.deepEqual(res, { liked: true, likes: 1 });
  const after = db.raw.prepare("SELECT hot, created_at FROM builds WHERE id = 'minemine'").get();
  assert.ok(Math.abs(after.hot - hotScore(1, after.created_at)) < 1e-9);
  assert.ok(after.hot > before);
  assert.equal(ids(await list(db)), "minemine newer000", "one like outweighs two days");
  // Unlike: back to the age alone.
  assert.deepEqual(await (await like({ env, params: { id: "minemine" }, data: { user: { steamId: FAN } } })).json(), { liked: false, likes: 0 });
  assert.ok(Math.abs(db.raw.prepare("SELECT hot FROM builds WHERE id = 'minemine'").get().hot - before) < 1e-9);
});
