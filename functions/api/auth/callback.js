// GET /api/auth/callback: Steam comes back here. Verifies the answer with Steam
// (check_authentication), stores the profile, sets the session cookie, redirects to "next".

import { safeNext } from "../../_lib/http.js";
import { readCookie, signSession, sessionCookie, clearCookie, STATE_COOKIE } from "../../_lib/session.js";
import { checkCallbackParams, verifyWithSteam } from "../../_lib/openid.js";
import { fetchProfile } from "../../_lib/steam.js";
import { upsertUser } from "../../_lib/builds.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const next = safeNext(params.get("next") || "/");

  const state = params.get("state");
  const cookieState = readCookie(request, STATE_COOKIE);
  if (!state || !cookieState || state !== cookieState) return fail(request, 400, "sign-in expired, try again");

  const check = checkCallbackParams(params, request.url, `${url.origin}/api/auth/callback`);
  if (check.error) return fail(request, check.error === "cancelled" ? 400 : 403, check.error);
  if (!(await verifyWithSteam(params))) return fail(request, 403, "Steam did not confirm the sign-in");

  const profile = await fetchProfile(check.steamId, env); // never throws
  await upsertUser(env, check.steamId, profile);
  const value = await signSession(check.steamId, env.SESSION_SECRET);
  const headers = new Headers({ Location: next, "Cache-Control": "no-store" });
  headers.append("Set-Cookie", sessionCookie(request, value));
  headers.append("Set-Cookie", clearCookie(request, STATE_COOKIE));
  return new Response(null, { status: 302, headers });
}

// A browser lands here: send it back to the site with a flag instead of a raw JSON page.
// The reason goes to the log only.
function fail(request, status, message) {
  console.warn("sign-in failed", status, message);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/?signin=failed",
      "Set-Cookie": clearCookie(request, STATE_COOKIE),
      "Cache-Control": "no-store",
    },
  });
}
