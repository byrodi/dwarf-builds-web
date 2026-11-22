// POST /api/builds/:id/report {reason} -> { ok: true }. One report per user per build.

import { json, error, readJson, cleanText, HttpError } from "../../../_lib/http.js";
import { isBuildId, requireActiveUser, REASON_MAX, REPORTS_PER_DAY } from "../../../_lib/builds.js";

export async function onRequestPost({ request, env, params, data }) {
  const id = params.id;
  if (!isBuildId(id)) return error(404, "build not found");
  const user = await requireActiveUser(env, data.user);
  const body = await readJson(request);
  const reason = cleanText(body.reason, { max: REASON_MAX, multiline: true, required: true, name: "reason" });

  const build = await env.DB.prepare("SELECT 1 AS x FROM builds WHERE id = ?").bind(id).first();
  if (!build) return error(404, "build not found");
  const day = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE user_id = ? AND created_at > ?")
    .bind(user.steam_id, Date.now() - 86400000)
    .first();
  if (day && day.n >= REPORTS_PER_DAY) throw new HttpError(429, "too many reports today");

  await env.DB.prepare(
    `INSERT INTO reports (build_id, user_id, reason, created_at)
     SELECT ?1, ?2, ?3, ?4 WHERE NOT EXISTS (SELECT 1 FROM reports WHERE build_id = ?1 AND user_id = ?2)`
  )
    .bind(id, user.steam_id, reason, Date.now())
    .run();
  return json({ ok: true });
}
