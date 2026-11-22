// Admin report queue: admins only, grouped by build, newest report first; dismiss removes the reports only.

import test from "node:test";
import assert from "node:assert/strict";
import { makeD1 } from "./d1.js";
import { onRequestGet as listReports } from "../functions/api/admin/reports.js";
import { onRequestDelete as dismiss } from "../functions/api/admin/reports/[id].js";

const AUTHOR = "76561197960287930";
const ADMIN = { steamId: "76561197960287999", admin: true };

function seed(db) {
  const user = db.raw.prepare("INSERT INTO users (steam_id, name, avatar, created_at, updated_at, banned) VALUES (?, ?, NULL, 0, 0, 0)");
  user.run(AUTHOR, "author");
  user.run("76561197960280001", "first reporter");
  const build = db.raw.prepare(
    `INSERT INTO builds (id, user_id, class, title, description, code, build_json, likes, hidden, created_at, updated_at)
     VALUES (?, ?, 'D', ?, '', 'DB1:D:1--0:0--0:0--0:0--0:0--0:0--0:0--0:', '{}', 0, 0, 1, 1)`
  );
  build.run("aaaaaaaa", AUTHOR, "old report");
  build.run("bbbbbbbb", AUTHOR, "new reports");
  build.run("cccccccc", AUTHOR, "clean");
  const report = db.raw.prepare("INSERT INTO reports (build_id, user_id, reason, created_at) VALUES (?, ?, ?, ?)");
  report.run("aaaaaaaa", "76561197960280001", "rude title", 100);
  report.run("bbbbbbbb", "76561197960280001", "spam", 200);
  report.run("bbbbbbbb", "76561197960280002", "copy of another build", 300);
}

const get = (db, user) => listReports({ request: new Request("https://dwarfbuilds.pages.dev/api/admin/reports"), env: { DB: db }, data: { user } });

test("reports: admins only", async () => {
  const db = makeD1();
  seed(db);
  await assert.rejects(get(db, null), (e) => e.status === 401);
  await assert.rejects(get(db, { steamId: AUTHOR, admin: false }), (e) => e.status === 403);
  await assert.rejects(dismiss({ env: { DB: db }, params: { id: "bbbbbbbb" }, data: { user: { steamId: AUTHOR, admin: false } } }),
    (e) => e.status === 403);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM reports").get().n, 3);
});

test("reports: grouped by build, newest first, reporter names", async () => {
  const db = makeD1();
  seed(db);
  const data = await (await get(db, ADMIN)).json();
  assert.deepEqual(data.builds.map((b) => [b.id, b.reportCount, b.lastReport]), [["bbbbbbbb", 2, 300], ["aaaaaaaa", 1, 100]]);
  const b = data.builds[0];
  assert.equal(b.title, "new reports");
  assert.deepEqual(b.reports.map((r) => [r.reason, r.user.name]), [["copy of another build", "Dwarf 0002"], ["spam", "first reporter"]]);
  assert.equal(data.hasMore, false);
});

test("reports: dismiss removes the reports, the build stays", async () => {
  const db = makeD1();
  seed(db);
  const r = await (await dismiss({ env: { DB: db }, params: { id: "bbbbbbbb" }, data: { user: ADMIN } })).json();
  assert.deepEqual(r, { ok: true, removed: 2 });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM builds WHERE id = 'bbbbbbbb'").get().n, 1);
  const data = await (await get(db, ADMIN)).json();
  assert.deepEqual(data.builds.map((b) => b.id), ["aaaaaaaa"]);
});
