// DELETE /api/admin/reports/:buildId (admin) -> { ok, removed }: dismisses every report of the build (the build stays).

import { json, error } from "../../../_lib/http.js";
import { isBuildId } from "../../../_lib/builds.js";
import { requireAdmin } from "../reports.js";

export async function onRequestDelete({ env, params, data }) {
  requireAdmin(data);
  if (!isBuildId(params.id)) return error(404, "build not found");
  const r = await env.DB.prepare("DELETE FROM reports WHERE build_id = ?").bind(params.id).run();
  return json({ ok: true, removed: (r.meta && r.meta.changes) || 0 });
}
