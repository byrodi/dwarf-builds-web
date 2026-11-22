// Small in-memory stand-in for a D1 binding (node:sqlite) with the real migrations applied.
// Records the query plan of every statement so tests can check index use.

import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS = new URL("../migrations/", import.meta.url);

export function makeD1() {
  const db = new DatabaseSync(":memory:");
  for (const f of fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(new URL(f, MIGRATIONS), "utf8"));
  }
  const plans = [];
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => {
      plan(sql, args);
      return db.prepare(sql).get(...args) || null;
    },
    all: async () => {
      plan(sql, args);
      return { results: db.prepare(sql).all(...args) };
    },
    run: async () => {
      plan(sql, args);
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes) } };
    },
  });
  function plan(sql, args) {
    if (/^\s*(SELECT|UPDATE|DELETE)/i.test(sql)) {
      plans.push({ sql, plan: db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail).join(" | ") });
    }
  }
  return {
    raw: db,
    plans,
    prepare: (sql) => stmt(sql),
    batch: async (list) => Promise.all(list.map((s) => s.run())),
  };
}
