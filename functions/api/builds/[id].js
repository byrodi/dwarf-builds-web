// GET    /api/builds/:id  -> one build + author
// PUT    /api/builds/:id  {title, description, code} (owner) -> { id, code }
// DELETE /api/builds/:id  (owner or admin) -> { ok: true }

import { json, error, readJson, HttpError } from "../../_lib/http.js";
import { loadGameData, requireGameData } from "../../_lib/gamedata.js";
import { isBuildId, author, currentCode, parseBuildBody, requireActiveUser } from "../../_lib/builds.js";

async function loadBuild(env, id) {
  return env.DB.prepare(
    `SELECT b.*, u.name AS author_name, u.avatar AS author_avatar, u.banned AS author_banned
     FROM builds b JOIN users u ON u.steam_id = b.user_id WHERE b.id = ?`
  )
    .bind(id)
    .first();
}

export async function onRequestGet({ request, env, params, data }) {
  const id = params.id;
  if (!isBuildId(id)) return error(404, "build not found");
  const row = await loadBuild(env, id);
  const user = data.user;
  const owner = !!user && row && row.user_id === user.steamId;
  const admin = !!user && user.admin;
  if (!row || ((row.hidden || row.author_banned) && !owner && !admin)) return error(404, "build not found");

  let liked = false;
  if (user) {
    liked = !!(await env.DB.prepare("SELECT 1 AS x FROM likes WHERE build_id = ? AND user_id = ?")
      .bind(id, user.steamId)
      .first());
  }
  const game = await loadGameData(env, request.url);
  const cur = currentCode(row, game);
  return json({
    id: row.id,
    class: row.class,
    title: row.title,
    description: row.description,
    code: cur.code,
    storedCode: row.code,
    rebuilt: cur.rebuilt,
    missing: cur.missing,
    primaryItem: row.primary_item,
    secondaryItem: row.secondary_item,
    primaryOc: row.primary_oc,
    secondaryOc: row.secondary_oc,
    likes: row.likes,
    liked,
    hidden: !!row.hidden,
    dataVersion: row.data_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: author(row),
    canEdit: owner,
    canDelete: owner || admin,
    canHide: admin,
  });
}

export async function onRequestPut({ request, env, params, data }) {
  const id = params.id;
  if (!isBuildId(id)) return error(404, "build not found");
  const user = await requireActiveUser(env, data.user);
  const row = await env.DB.prepare("SELECT user_id FROM builds WHERE id = ?").bind(id).first();
  if (!row) return error(404, "build not found");
  if (row.user_id !== user.steam_id) throw new HttpError(403, "not your build");
  const body = await readJson(request);
  const game = await requireGameData(env, request.url);
  const b = parseBuildBody(body, game);
  await env.DB.prepare(
    `UPDATE builds SET class = ?, title = ?, description = ?, code = ?, build_json = ?, primary_item = ?,
       secondary_item = ?, primary_oc = ?, secondary_oc = ?, data_version = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  )
    .bind(b.class, b.title, b.description, b.code, b.buildJson, b.primaryItem, b.secondaryItem, b.primaryOc,
      b.secondaryOc, b.dataVersion, Date.now(), id, user.steam_id)
    .run();
  return json({ id, code: b.code });
}

export async function onRequestDelete({ env, params, data }) {
  const id = params.id;
  if (!isBuildId(id)) return error(404, "build not found");
  const user = data.user;
  if (!user) throw new HttpError(401, "sign in first");
  const row = await env.DB.prepare("SELECT user_id FROM builds WHERE id = ?").bind(id).first();
  if (!row) return error(404, "build not found");
  if (row.user_id !== user.steamId && !user.admin) throw new HttpError(403, "not your build");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM builds WHERE id = ?").bind(id),
    env.DB.prepare("DELETE FROM likes WHERE build_id = ?").bind(id),
    env.DB.prepare("DELETE FROM reports WHERE build_id = ?").bind(id),
  ]);
  return json({ ok: true });
}
