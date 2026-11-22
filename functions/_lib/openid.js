// Steam OpenID 2.0 (no API key needed).

export const STEAM_OP = "https://steamcommunity.com/openid/login";
const NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";
const CLAIMED_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119[0-9]{10})$/;

// URL of the Steam sign-in page. returnTo must be on origin.
export function loginUrl(origin, returnTo) {
  const p = new URLSearchParams({
    "openid.ns": NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": origin,
    "openid.identity": IDENTIFIER_SELECT,
    "openid.claimed_id": IDENTIFIER_SELECT,
  });
  return `${STEAM_OP}?${p.toString()}`;
}

// An assertion is accepted for this long after Steam made it (response_nonce time).
export const NONCE_MAX_AGE_MS = 10 * 60 * 1000;
const NONCE_SKEW_MS = 5 * 60 * 1000;

// A key given twice would let the checked value (first) differ from the one Steam verifies.
export function hasDuplicateKeys(params) {
  const seen = new Set();
  for (const k of params.keys()) {
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

// Checks the callback query before asking Steam. expectedReturnTo is the callback URL without
// query; requestUrl is the URL the browser came back to. Returns { steamId } or { error }.
export function checkCallbackParams(params, requestUrl, expectedReturnTo, nowMs = Date.now()) {
  const g = (k) => params.get(k);
  if (hasDuplicateKeys(params)) return { error: "duplicate query key" };
  if (g("openid.ns") !== NS) return { error: "bad openid.ns" };
  if (g("openid.mode") !== "id_res") return { error: g("openid.mode") === "cancel" ? "cancelled" : "bad openid.mode" };
  if (g("openid.op_endpoint") !== STEAM_OP) return { error: "bad openid.op_endpoint" };
  const claimed = g("openid.claimed_id") || "";
  const m = CLAIMED_RE.exec(claimed);
  if (!m) return { error: "bad openid.claimed_id" };
  if (g("openid.identity") !== claimed) return { error: "openid.identity differs from claimed_id" };

  // return_to must be our callback, and must match the URL we were actually called with.
  const rt = g("openid.return_to") || "";
  let rtUrl;
  try {
    rtUrl = new URL(rt);
  } catch {
    return { error: "bad openid.return_to" };
  }
  if (`${rtUrl.origin}${rtUrl.pathname}` !== expectedReturnTo) return { error: "openid.return_to is not ours" };
  const req = new URL(requestUrl);
  if (`${req.origin}${req.pathname}` !== expectedReturnTo) return { error: "callback URL mismatch" };
  for (const [k, v] of rtUrl.searchParams) {
    if (req.searchParams.get(k) !== v) return { error: "openid.return_to query mismatch" };
  }

  // The fields we rely on must be covered by the signature.
  const signed = new Set((g("openid.signed") || "").split(","));
  for (const f of ["op_endpoint", "claimed_id", "identity", "return_to", "response_nonce", "assoc_handle"]) {
    if (!signed.has(f)) return { error: `openid.${f} is not signed` };
  }
  if (!g("openid.sig")) return { error: "no openid.sig" };

  // Old assertions (a leaked callback URL) are refused: the nonce starts with Steam's UTC time.
  const nm = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)/.exec(g("openid.response_nonce") || "");
  const at = nm ? Date.parse(nm[1]) : NaN;
  if (!Number.isFinite(at) || nowMs - at > NONCE_MAX_AGE_MS || at - nowMs > NONCE_SKEW_MS) {
    return { error: "openid.response_nonce is too old" };
  }
  return { steamId: m[1] };
}

// Asks Steam whether the assertion is genuine. fetchImpl is injectable for tests.
export async function verifyWithSteam(params, fetchImpl = fetch) {
  if (hasDuplicateKeys(params)) return false;
  const body = new URLSearchParams();
  for (const [k, v] of params) {
    if (k.startsWith("openid.")) body.set(k, v);
  }
  body.set("openid.mode", "check_authentication");
  let res;
  try {
    res = await fetchImpl(STEAM_OP, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/plain" },
      body: body.toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return false;
  }
  if (!res || res.status !== 200) return false;
  const text = await res.text();
  // Key-value form: one "key:value" per line.
  return text.split("\n").some((line) => line.trim() === "is_valid:true");
}
