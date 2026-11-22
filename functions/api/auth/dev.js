// GET /api/auth/dev?steamid=...&next=/path : local development sign-in without Steam.
// Works only when DEV_LOGIN is "1" (from .dev.vars) AND the host is localhost. Never in production.

import { error, isLocalHost, safeNext } from "../../_lib/http.js";
import { isSteamId, signSession, sessionCookie } from "../../_lib/session.js";
import { upsertUser } from "../../_lib/builds.js";

export async function onRequestGet({ request, env }) {
  if (env.DEV_LOGIN !== "1" || !isLocalHost(request.url)) return error(404, "not found");
  const url = new URL(request.url);
  const steamId = url.searchParams.get("steamid") || "76561197960287930";
  if (!isSteamId(steamId)) return error(400, "bad steamid");
  await upsertUser(env, steamId, { name: `Dev ${steamId.slice(-4)}`, avatar: null });
  const value = await signSession(steamId, env.SESSION_SECRET);
  return new Response(null, {
    status: 302,
    headers: {
      Location: safeNext(url.searchParams.get("next") || "/"),
      "Set-Cookie": sessionCookie(request, value),
      "Cache-Control": "no-store",
    },
  });
}
