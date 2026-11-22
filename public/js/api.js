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

// Answers to GET are kept for a short time, by path: going back to a list or opening the same build again draws
// at once, and the router can ask for a page's data before the page does (the page then gets that same answer).
// A failed call is not kept, and any write drops them all. Two minutes: long enough to read a build and go back
// to the list, so what others did meanwhile (a like, a new build) shows that much later.
const KEEP_MS = 120000;
const KEEP_MAX = 40;
const kept = new Map(); // path -> { at, promise }

function get(path) {
  const hit = kept.get(path);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.promise;
  const promise = call("GET", path);
  kept.delete(path);
  kept.set(path, { at: Date.now(), promise });
  if (kept.size > KEEP_MAX) kept.delete(kept.keys().next().value);
  promise.catch(() => {
    const now = kept.get(path);
    if (now && now.promise === promise) kept.delete(path);
  });
  return promise;
}

function write(method, path, body) {
  kept.clear();
  return call(method, path, body).finally(() => kept.clear());
}

export const api = {
  get,
  post: (path, body) => write("POST", path, body),
  put: (path, body) => write("PUT", path, body),
  del: (path) => write("DELETE", path, {}),
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
