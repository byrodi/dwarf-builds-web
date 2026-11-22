// JSON responses, errors, request checks.

export const API_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  const h = new Headers(API_HEADERS);
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
    else h.set(k, v);
  }
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function error(status, message, headers = {}) {
  return json({ error: message }, status, headers);
}

// Adds the security headers to any response (used by the middleware for non-JSON ones too).
export function withSecurityHeaders(res) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(API_HEADERS)) {
    if (k === "Content-Type") continue;
    if (!out.headers.has(k)) out.headers.set(k, v);
  }
  return out;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutating(method) {
  return MUTATING.has(method);
}

// CSRF and abuse guard for POST/PUT/PATCH/DELETE: JSON body type, custom header, same Origin.
// Returns an error message or null.
export function csrfProblem(request) {
  const ct = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!ct.startsWith("application/json")) return "Content-Type must be application/json";
  if (request.headers.get("X-Dwarfbuilds") !== "1") return "missing X-Dwarfbuilds header";
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return "bad Origin";
  return null;
}

export const MAX_BODY = 16 * 1024;

export async function readJson(request) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BODY) throw new HttpError(413, "body too large");
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "body too large");
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, "body is not a JSON object");
  }
}

// Plain-text field: strips control chars (keeps \n and \t when multiline: descriptions are Markdown,
// where a tab indents a list or code), trims, checks length in code points.
export function cleanText(value, { max, multiline = false, required = false, name = "text" }) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw new HttpError(400, `${name} must be a string`);
  let s = value.replace(/\r\n?/g, "\n");
  s = multiline
    ? s.replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    : s.replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, " ");
  s = s.trim();
  if (multiline) s = s.replace(/\n{4,}/g, "\n\n\n");
  else s = s.replace(/\s{2,}/g, " ");
  if (required && !s) throw new HttpError(400, `${name} is required`);
  if ([...s].length > max) throw new HttpError(400, `${name} is longer than ${max} characters`);
  return s;
}

export function isLocalHost(url) {
  const h = new URL(url).hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

// A local path to go back to after sign-in ("/b/abc"); anything else becomes "/".
export function safeNext(value) {
  if (typeof value !== "string" || value.length > 300) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001F]/.test(value)) return "/";
  return value;
}
