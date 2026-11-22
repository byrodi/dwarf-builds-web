// Steam profile name and avatar. Never throws: sign-in must not fail because of this.

const AVATAR_RE = /^https:\/\/(?:(?:[a-z0-9-]+\.)*steamstatic\.com|steamcdn-a\.akamaihd\.net)\/[A-Za-z0-9_./-]{1,200}$/;

export function cleanName(s) {
  if (typeof s !== "string") return null;
  const t = s.replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "").trim();
  const cut = [...t].slice(0, 64).join("");
  return cut || null;
}

export function cleanAvatar(s) {
  if (typeof s !== "string") return null;
  s = s.trim();
  return s.length <= 300 && AVATAR_RE.test(s) ? s : null;
}

function cdata(xml, tag) {
  const m = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${tag}>`).exec(xml);
  if (!m) return null;
  const v = m[1] !== undefined ? m[1] : m[2];
  return v
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Returns { name, avatar } (fields may be null).
export async function fetchProfile(steamId, env, fetchImpl = fetch) {
  const empty = { name: null, avatar: null };
  try {
    if (env.STEAM_API_KEY) {
      const u = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
      u.searchParams.set("key", env.STEAM_API_KEY);
      u.searchParams.set("steamids", steamId);
      const res = await fetchImpl(u.toString(), { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        const p = data && data.response && Array.isArray(data.response.players) ? data.response.players[0] : null;
        if (p && p.steamid === steamId) {
          return { name: cleanName(p.personaname), avatar: cleanAvatar(p.avatarfull || p.avatarmedium) };
        }
      }
    }
    const res = await fetchImpl(`https://steamcommunity.com/profiles/${steamId}/?xml=1`, {
      signal: AbortSignal.timeout(4000),
      redirect: "follow",
    });
    if (!res.ok) return empty;
    const xml = (await res.text()).slice(0, 200000);
    if (cdata(xml, "steamID64") !== steamId) return empty;
    return { name: cleanName(cdata(xml, "steamID")), avatar: cleanAvatar(cdata(xml, "avatarFull") || cdata(xml, "avatarMedium")) };
  } catch {
    return empty;
  }
}
