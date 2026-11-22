// Fixes from the security review that need a database: write budget, index use, paging cap.

import test from "node:test";
import assert from "node:assert/strict";
import { makeD1 } from "./d1.js";
import { requireActiveUser, WRITES_PER_DAY, MAX_PAGE, PAGE_SIZE } from "../functions/_lib/builds.js";
import { onRequestGet as userPage } from "../functions/api/users/[steamid].js";
import { onRequestGet as listBuilds } from "../functions/api/builds/index.js";

const A = "76561197960287930";
const B = "76561197960287931";
const DAY = 86400000;

function seed(db, { builds = 0 } = {}) {
  db.raw.prepare("INSERT INTO users (steam_id, name, avatar, created_at, updated_at, banned) VALUES (?, 'a', NULL, 0, 0, 0)").run(A);
  db.raw.prepare("INSERT INTO users (steam_id, name, avatar, created_at, updated_at, banned) VALUES (?, 'b', NULL, 0, 0, 1)").run(B);
  const ins = db.raw.prepare(
    `INSERT INTO builds (id, user_id, class, title, description, code, build_json, likes, hidden, created_at, updated_at)
     VALUES (?, ?, 'D', 't', '', 'DB1:D:1--0:0--0:0--0:0--0:0--0:0--0:0--0:', '{}', 0, 0, ?, ?)`
  );
  for (let i = 0; i < builds; i++) ins.run(`b${String(i).padStart(7, "0")}`, A, i, i);
}

test("daily write budget per user", async () => {
  const db = makeD1();
  seed(db);
  const env = { DB: db };
  const now = 20000 * DAY + 5000;
  for (let i = 0; i < WRITES_PER_DAY; i++) {
    const row = await requireActiveUser(env, { steamId: A }, now);
    assert.equal(row.steam_id, A);
  }
  await assert.rejects(requireActiveUser(env, { steamId: A }, now), (e) => e.status === 429);
  const writes = db.raw.prepare("SELECT write_count FROM users WHERE steam_id = ?").get(A).write_count;
  assert.equal(writes, WRITES_PER_DAY, "no row write once the budget is used up");
  // Next UTC day starts again.
  assert.equal((await requireActiveUser(env, { steamId: A }, now + DAY)).steam_id, A);
  assert.equal(db.raw.prepare("SELECT write_count FROM users WHERE steam_id = ?").get(A).write_count, 1);
  // Banned, unknown, signed out.
  await assert.rejects(requireActiveUser(env, { steamId: B }, now), (e) => e.status === 403);
  await assert.rejects(requireActiveUser(env, { steamId: "76561197960287999" }, now), (e) => e.status === 401);
  await assert.rejects(requireActiveUser(env, null, now), (e) => e.status === 401);
});

test("user page reads by user index, not every public build", async () => {
  const db = makeD1();
  seed(db, { builds: 3 });
  const res = await userPage({
    request: new Request(`https://dwarfbuilds.pages.dev/api/users/${A}`),
    env: { DB: db },
    params: { steamid: A },
    data: { user: null },
  });
  assert.equal((await res.json()).builds.length, 3);
  const p = db.plans.find((x) => /FROM builds b JOIN users/.test(x.sql));
  assert.match(p.plan, /builds_user_created/, p.plan);
  assert.doesNotMatch(p.plan, /builds_hidden_created/, p.plan);
});

test("paging stops at MAX_PAGE", async () => {
  const db = makeD1();
  seed(db, { builds: MAX_PAGE * PAGE_SIZE + 5 });
  const get = async (page) => (await listBuilds({
    request: new Request(`https://dwarfbuilds.pages.dev/api/builds?page=${page}`),
    env: { DB: db },
  })).json();
  assert.equal((await get(1)).hasMore, true);
  const last = await get(MAX_PAGE);
  assert.equal(last.page, MAX_PAGE);
  assert.equal(last.builds.length, PAGE_SIZE);
  assert.equal(last.hasMore, false, "no link to a page the server will not serve");
  assert.equal((await get(MAX_PAGE + 7)).page, MAX_PAGE);
});
