// GET  /api/builds?class=&item=&oc=&q=&sort=hot|new|top&period=week|month|all&page=
//                                                        -> { builds, page, pageSize, hasMore, sort, period }
//      hot (the default): likes against age (builds.hot); top: most likes made in the period (month by default).
// POST /api/builds {title, description, code}           -> 201 { id, code }

import { json, error, readJson, HttpError } from "../../_lib/http.js";
import { requireGameData } from "../../_lib/gamedata.js";
import {
  PAGE_SIZE,
  MAX_PAGE,
  BUILDS_PER_DAY,
  TOP_PERIODS,
  TOP_CACHE_SECONDS,
  CARD_COLUMNS,
  card,
  likePattern,
  parsePage,
  parseBuildBody,
  requireActiveUser,
  newId,
  hotScore,
} from "../../_lib/builds.js";

const SORTS = ["hot", "new", "top"];

const CLASS_KEYS = { driller: "D", engineer: "E", gunner: "G", scout: "S" };

export function parseClass(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^[DEGS]$/i.test(s)) return s.toUpperCase();
  return CLASS_KEYS[s.toLowerCase()] || undefined;
}

// The edge cache (Cloudflare only; absent in tests and plain Node).
function edgeCache() {
  return typeof caches !== "undefined" && caches.default ? caches.default : null;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const p = url.searchParams;
  const item = (p.get("item") || "").trim();
  if (item && !/^[A-Za-z0-9_]{1,64}$/.test(item)) return error(400, "bad item");
  const oc = (p.get("oc") || "").trim();
  if (oc && !/^[A-Za-z0-9_]{1,64}$/.test(oc)) return error(400, "bad oc");
  const sort = SORTS.includes(p.get("sort")) ? p.get("sort") : "hot";
  const period = sort !== "top" ? null : Object.hasOwn(TOP_PERIODS, p.get("period")) ? p.get("period") : "month";
  const days = period ? TOP_PERIODS[period] : 0;
  // With an item filter the item indexes are the narrow ones: "+" keeps SQLite from picking the
  // (hidden, class, ...) index and scanning every build for a rare weapon. TOP of a period starts from the
  // likes of that period and reads the builds by id, so it does the same.
  const plus = item || days ? "+" : "";
  const where = [`${plus}b.hidden = 0`, "u.banned = 0"];
  const args = [];

  const cls = parseClass(p.get("class"));
  if (cls === undefined) return error(400, "bad class");
  if (cls) {
    where.push(`${plus}b.class = ?`);
    args.push(cls);
  }
  if (item) {
    where.push("(b.primary_item = ? OR b.secondary_item = ?)");
    args.push(item, item);
  }
  if (oc) {
    where.push("(b.primary_oc = ? OR b.secondary_oc = ?)");
    args.push(oc, oc);
  }
  const q = (p.get("q") || "").trim().slice(0, 60);
  if (q) {
    where.push("b.title LIKE ? ESCAPE '\\'");
    args.push(likePattern(q));
  }
  const page = parsePage(p.get("page"));

  // TOP of a period counts likes rows, so the answer is kept at the edge for a few minutes: a new like, a hidden
  // build or a ban shows there that much later.
  const cache = days ? edgeCache() : null;
  const cacheKey = cache
    ? new Request(`${url.origin}/api/builds?${new URLSearchParams(
      { sort, period, page: String(page), class: cls || "", item, oc, q }).toString()}`)
    : null;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return json(await hit.json());
  }

  let sql;
  if (days) {
    // Only builds liked in the period: the likes index (created_at, build_id) gives the counts, then the builds
    // come by id (CROSS JOIN keeps that order: the planner would scan every public build instead).
    sql = `SELECT ${CARD_COLUMNS} FROM
      (SELECT build_id, COUNT(*) AS n FROM likes INDEXED BY likes_created_build WHERE created_at >= ? GROUP BY build_id) t
      CROSS JOIN builds b ON b.id = t.build_id JOIN users u ON u.steam_id = b.user_id
      WHERE ${where.join(" AND ")} ORDER BY t.n DESC, b.created_at DESC LIMIT ? OFFSET ?`;
    args.unshift(Date.now() - days * 86400000);
  } else {
    const order = sort === "hot" ? "b.hot DESC" : sort === "top" ? "b.likes DESC, b.created_at DESC" : "b.created_at DESC";
    sql = `SELECT ${CARD_COLUMNS} FROM builds b JOIN users u ON u.steam_id = b.user_id
      WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`;
  }
  args.push(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  const rows = results || [];
  const body = {
    builds: rows.slice(0, PAGE_SIZE).map(card), page, pageSize: PAGE_SIZE,
    hasMore: rows.length > PAGE_SIZE && page < MAX_PAGE, sort, period,
  };
  if (cache) await cache.put(cacheKey, json(body, 200, { "Cache-Control": `public, max-age=${TOP_CACHE_SECONDS}` }));
  return json(body);
}

export async function onRequestPost({ request, env, data }) {
  const user = await requireActiveUser(env, data.user);
  const body = await readJson(request);
  const game = await requireGameData(env, request.url);
  const b = parseBuildBody(body, game);

  const now = Date.now();
  const day = await env.DB.prepare("SELECT COUNT(*) AS n FROM builds WHERE user_id = ? AND created_at > ?")
    .bind(user.steam_id, now - 86400000)
    .first();
  if (day && day.n >= BUILDS_PER_DAY) throw new HttpError(429, `at most ${BUILDS_PER_DAY} new builds per day`);

  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newId();
    try {
      await env.DB.prepare(
        `INSERT INTO builds (id, user_id, class, title, description, code, build_json, primary_item,
           secondary_item, primary_oc, secondary_oc, likes, hidden, data_version, created_at, updated_at, hot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`
      )
        .bind(id, user.steam_id, b.class, b.title, b.description, b.code, b.buildJson, b.primaryItem,
          b.secondaryItem, b.primaryOc, b.secondaryOc, b.dataVersion, now, now, hotScore(0, now))
        .run();
      return json({ id, code: b.code }, 201);
    } catch (e) {
      if (!/UNIQUE|constraint/i.test(String(e && e.message))) throw e;
    }
  }
  throw new HttpError(500, "could not make an id");
}
