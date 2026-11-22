// All /api routes: CSRF guard for writes, JSON errors, security headers, current user.

import { HttpError, error, isMutating, csrfProblem, withSecurityHeaders } from "../_lib/http.js";
import { currentUser } from "../_lib/session.js";

export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (isMutating(request.method)) {
      const problem = csrfProblem(request);
      if (problem) return error(403, problem);
    }
    context.data.user = await currentUser(request, env);
    const res = await context.next();
    return withSecurityHeaders(res);
  } catch (e) {
    if (e instanceof HttpError) return error(e.status, e.message);
    console.error("api error", request.method, new URL(request.url).pathname, e && e.stack ? e.stack : e);
    return error(500, "server error");
  }
}
