// GET /api/users/:steamid?page= -> { user, builds, page, pageSize, hasMore }
// The owner (and admins) also see hidden builds.

import { json, error } from "../../_lib/http.js";
import { isSteamId } from "../../_lib/session.js";
import { CARD_COLUMNS, PAGE_SIZE, MAX_PAGE, card, displayName, parsePage } from "../../_lib/builds.js";

export async function onRequestGet({ request, env, params, data }) {
  const steamId = params.steamid;
  if (!isSteamId(steamId)) return error(404, "user not found");
  const u = await env.DB.prepare("SELECT steam_id, name, avatar, banned, created_at FROM users WHERE steam_id = ?")
    .bind(steamId)
    .first();
  const self = !!data.user && (data.user.steamId === steamId || data.user.admin);
  if (!u || (u.banned && !self)) return error(404, "user not found");

  const page = parsePage(new URL(request.url).searchParams.get("page"));
  // "+" keeps SQLite on builds_user_created: the (hidden, created_at) index would read every public build.
  const { results } = await env.DB.prepare(
    `SELECT ${CARD_COLUMNS} FROM builds b JOIN users u ON u.steam_id = b.user_id
     WHERE b.user_id = ? ${self ? "" : "AND +b.hidden = 0"} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(steamId, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE)
    .all();
  const rows = results || [];
  return json({
    user: { steamId: u.steam_id, name: displayName(u.name, u.steam_id), avatar: u.avatar || null, createdAt: u.created_at },
    builds: rows.slice(0, PAGE_SIZE).map(card),
    page,
    pageSize: PAGE_SIZE,
    hasMore: rows.length > PAGE_SIZE && page < MAX_PAGE,
  });
}
