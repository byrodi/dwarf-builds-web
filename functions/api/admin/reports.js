// GET /api/admin/reports?page= (admin) -> { builds: [card + {reportCount, lastReport, reports}], page, pageSize, hasMore }
// Reported builds, the most recently reported first; each with its reports (newest first, at most REPORTS_SHOWN).
// Hidden builds and builds of banned authors are listed too: the admin decides about them.

import { json, HttpError } from "../../_lib/http.js";
import { CARD_COLUMNS, MAX_PAGE, card, displayName, parsePage } from "../../_lib/builds.js";

export const REPORT_PAGE_SIZE = 20;
export const REPORTS_SHOWN = 20;

export function requireAdmin(data) {
  if (!data.user) throw new HttpError(401, "sign in first");
  if (!data.user.admin) throw new HttpError(403, "admins only");
}

export async function onRequestGet({ request, env, data }) {
  requireAdmin(data);
  const page = parsePage(new URL(request.url).searchParams.get("page"));
  const { results: groups } = await env.DB.prepare(
    `SELECT build_id, COUNT(*) AS n, MAX(created_at) AS last FROM reports GROUP BY build_id
     ORDER BY last DESC LIMIT ? OFFSET ?`
  )
    .bind(REPORT_PAGE_SIZE + 1, (page - 1) * REPORT_PAGE_SIZE)
    .all();
  const shown = (groups || []).slice(0, REPORT_PAGE_SIZE);
  const out = [];
  for (const g of shown) {
    const row = await env.DB.prepare(
      `SELECT ${CARD_COLUMNS}, u.banned AS author_banned FROM builds b JOIN users u ON u.steam_id = b.user_id WHERE b.id = ?`
    )
      .bind(g.build_id)
      .first();
    if (!row) continue; // reports outlive nothing: a deleted build takes its reports with it
    const { results: reports } = await env.DB.prepare(
      `SELECT r.reason, r.created_at, r.user_id, u.name FROM reports r LEFT JOIN users u ON u.steam_id = r.user_id
       WHERE r.build_id = ? ORDER BY r.created_at DESC LIMIT ?`
    )
      .bind(g.build_id, REPORTS_SHOWN)
      .all();
    out.push({
      ...card(row),
      authorBanned: !!row.author_banned,
      reportCount: g.n,
      lastReport: g.last,
      reports: (reports || []).map((r) => ({
        reason: r.reason,
        createdAt: r.created_at,
        user: { steamId: r.user_id, name: displayName(r.name, r.user_id) },
      })),
    });
  }
  return json({
    builds: out,
    page,
    pageSize: REPORT_PAGE_SIZE,
    hasMore: (groups || []).length > REPORT_PAGE_SIZE && page < MAX_PAGE,
  });
}
