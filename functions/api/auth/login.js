// GET /api/auth/login?next=/path -> redirect to Steam sign-in.
// A random state in a short cookie ties the callback to this browser (no login CSRF).

import { safeNext } from "../../_lib/http.js";
import { shortCookie, STATE_COOKIE } from "../../_lib/session.js";
import { loginUrl } from "../../_lib/openid.js";
import { newId } from "../../_lib/builds.js";

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next") || "/");
  const state = newId(16);
  const returnTo = new URL("/api/auth/callback", url.origin);
  returnTo.searchParams.set("state", state);
  returnTo.searchParams.set("next", next);
  return new Response(null, {
    status: 302,
    headers: {
      Location: loginUrl(url.origin, returnTo.toString()),
      "Set-Cookie": shortCookie(request, STATE_COOKIE, state, 600),
      "Cache-Control": "no-store",
    },
  });
}
