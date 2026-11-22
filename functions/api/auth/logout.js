// POST /api/auth/logout: clears the session cookie.

import { json } from "../../_lib/http.js";
import { clearCookie } from "../../_lib/session.js";

export async function onRequestPost({ request }) {
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie(request) });
}
