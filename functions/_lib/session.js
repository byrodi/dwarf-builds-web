// Session cookie db_session = <steamid>.<expiry>.<hmac>
// expiry: unix seconds; hmac: base64url HMAC-SHA256(SESSION_SECRET, "<steamid>.<expiry>").
// Checked with WebCrypto only: no DB read per request.

export const COOKIE = "db_session";
export const STATE_COOKIE = "db_oid"; // OpenID state, 10 minutes
export const SESSION_DAYS = 30;
const enc = new TextEncoder();
const keyCache = new Map();

export function isSteamId(s) {
  return typeof s === "string" && /^7656119[0-9]{10}$/.test(s);
}

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s) {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  try {
    const bin = atob(pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmacKey(secret) {
  if (!secret || typeof secret !== "string") throw new Error("SESSION_SECRET is not set");
  let k = keyCache.get(secret);
  if (!k) {
    k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
    keyCache.set(secret, k);
  }
  return k;
}

export async function signSession(steamId, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (!isSteamId(steamId)) throw new Error("bad steam id");
  const expiry = nowSec + SESSION_DAYS * 86400;
  const payload = `${steamId}.${expiry}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

// Returns { steamId, expiry } or null.
export async function verifySession(value, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (typeof value !== "string" || value.length > 200) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [steamId, expText, sigText] = parts;
  if (!isSteamId(steamId) || !/^[0-9]{1,12}$/.test(expText)) return null;
  const expiry = Number(expText);
  if (expiry <= nowSec) return null;
  const sig = fromB64url(sigText);
  if (!sig || sig.length !== 32) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, enc.encode(`${steamId}.${expText}`));
  } catch {
    return null;
  }
  return ok ? { steamId, expiry } : null;
}

export function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function cookieAttrs(request) {
  // Secure on https (production). Plain http only happens on localhost in dev.
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function sessionCookie(request, value) {
  return `${COOKIE}=${value}; Max-Age=${SESSION_DAYS * 86400}; ${cookieAttrs(request)}`;
}

export function clearCookie(request, name = COOKIE) {
  return `${name}=; Max-Age=0; ${cookieAttrs(request)}`;
}

export function shortCookie(request, name, value, maxAge) {
  return `${name}=${value}; Max-Age=${maxAge}; ${cookieAttrs(request)}`;
}

// Current user from the cookie: { steamId, admin } or null.
export async function currentUser(request, env) {
  const v = readCookie(request, COOKIE);
  if (!v || !env.SESSION_SECRET) return null;
  const s = await verifySession(v, env.SESSION_SECRET);
  if (!s) return null;
  return { steamId: s.steamId, admin: isAdmin(env, s.steamId) };
}

export function isAdmin(env, steamId) {
  const list = String(env.ADMIN_STEAM_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(steamId);
}
