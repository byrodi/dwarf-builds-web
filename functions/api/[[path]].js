// Any other /api path (or a method a route does not have): JSON 404 instead of the SPA page.

import { error } from "../_lib/http.js";

export function onRequest() {
  return error(404, "not found");
}
