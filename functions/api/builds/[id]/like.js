// POST /api/builds/:id/like -> toggles the like; { liked, likes }.
// builds.likes is kept by triggers on the likes table (see migrations).

import { json, error } from "../../../_lib/http.js";
import { isBuildId, requireActiveUser } from "../../../_lib/builds.js";

export async function onRequestPost({ env, params, data }) {
  const id = params.id;
  if (!isBuildId(id)) return error(404, "build not found");
  const user = await requireActiveUser(env, data.user);

  const del = await env.DB.prepare("DELETE FROM likes WHERE build_id = ? AND user_id = ?")
    .bind(id, user.steam_id)
    .run();
  let liked = false;
  if (!del.meta || !del.meta.changes) {
    const ins = await env.DB.prepare(
      `INSERT OR IGNORE INTO likes (build_id, user_id, created_at)
       SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM builds WHERE id = ?1 AND hidden = 0)`
    )
      .bind(id, user.steam_id, Date.now())
      .run();
    liked = !!(ins.meta && ins.meta.changes);
  }
  const row = await env.DB.prepare("SELECT likes, hidden FROM builds WHERE id = ?").bind(id).first();
  if (!row) return error(404, "build not found");
  return json({ liked, likes: row.likes });
}
