// game.json from the static assets, cached per isolate (parsed data only: promises and
// responses are never shared between requests, which Workers does not allow).

import { HttpError } from "./http.js";

const TTL_MS = 10 * 60 * 1000;
let cached = null; // { data, at }

export function clearGameDataCache() {
  cached = null;
}

// Returns the parsed game data or null when it is not there.
export async function loadGameData(env, requestUrl) {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
  try {
    if (!env.ASSETS) return cached ? cached.data : null;
    const res = await env.ASSETS.fetch(new URL("/data/game.json", requestUrl).toString());
    if (!res.ok) return cached ? cached.data : null;
    const data = await res.json();
    if (!data || !Array.isArray(data.classes) || !Array.isArray(data.perks)) return cached ? cached.data : null;
    cached = { data, at: Date.now() };
    return data;
  } catch {
    return cached ? cached.data : null;
  }
}

export async function requireGameData(env, requestUrl) {
  const data = await loadGameData(env, requestUrl);
  if (!data) throw new HttpError(503, "game data is not available");
  return data;
}
