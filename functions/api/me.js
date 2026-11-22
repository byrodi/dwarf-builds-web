// GET /api/me -> current user or null.

import { json } from "../_lib/http.js";
import { getUserRow, displayName } from "../_lib/builds.js";

export async function onRequestGet({ env, data }) {
  const user = data.user;
  if (!user) return json(null);
  const row = await getUserRow(env, user.steamId);
  if (!row) return json(null);
  return json({
    steamId: row.steam_id,
    name: displayName(row.name, row.steam_id),
    avatar: row.avatar || null,
    admin: user.admin,
    banned: !!row.banned,
  });
}
