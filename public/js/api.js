// JSON API calls (see Web/README.md). Writes send the headers the API's CSRF guard asks for.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(method, path, body) {
  const opts = { method, credentials: "same-origin", headers: { Accept: "application/json" } };
  if (method !== "GET") {
    opts.headers["Content-Type"] = "application/json";
    opts.headers["X-Dwarfbuilds"] = "1";
    opts.body = JSON.stringify(body || {});
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = data && data.error ? data.error : `Server error (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data;
}

export const api = {
  get: (path) => call("GET", path),
  post: (path, body) => call("POST", path, body),
  put: (path, body) => call("PUT", path, body),
  del: (path) => call("DELETE", path, {}),
};

// Friendly text for an API error.
export function errorText(e) {
  if (!e) return "Something went wrong.";
  if (e.status === 401) return "Sign in with Steam first.";
  if (e.status === 403 && /banned/i.test(e.message)) return "This account is banned.";
  if (e.status === 403) return "You are not allowed to do that.";
  if (e.status === 429) return `Slow down: ${e.message}.`;
  const m = String(e.message || "Something went wrong.");
  return m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? "" : ".");
}

export function loginUrl(next) {
  return `/api/auth/login?next=${encodeURIComponent(next || "/")}`;
}
