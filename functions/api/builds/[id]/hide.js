// POST /api/builds/:id/hide {hidden: true|false} (admin) -> { id, hidden }

import { json, error, readJson, HttpError } from "../../../_lib/http.js";
import { isBuildId } from "../../../_lib/builds.js";

export async function onRequestPost({ request, env, params, data }) {
  const id = params.id;
  if (!isBuildId(id)) return error(404, "build not found");
  if (!data.user) throw new HttpError(401, "sign in first");
  if (!data.user.admin) throw new HttpError(403, "admins only");
  const body = await readJson(request);
  if (typeof body.hidden !== "boolean") throw new HttpError(400, "hidden must be true or false");
  const r = await env.DB.prepare("UPDATE builds SET hidden = ? WHERE id = ?").bind(body.hidden ? 1 : 0, id).run();
  if (!r.meta || !r.meta.changes) return error(404, "build not found");
  return json({ id, hidden: body.hidden });
}
