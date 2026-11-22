import test from "node:test";
import assert from "node:assert/strict";
import { loginUrl, checkCallbackParams, verifyWithSteam, STEAM_OP } from "../functions/_lib/openid.js";
import { fetchProfile, cleanName, cleanAvatar } from "../functions/_lib/steam.js";

const ORIGIN = "https://dwarfbuilds.pages.dev";
const CB = `${ORIGIN}/api/auth/callback`;
const ID = "76561197960287930";

function steamAnswer(overrides = {}) {
  const returnTo = `${CB}?state=abc&next=%2Fnew`;
  const p = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": STEAM_OP,
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${ID}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${ID}`,
    "openid.return_to": returnTo,
    "openid.response_nonce": `${new Date().toISOString().slice(0, 19)}Zabc`,
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "c2lnbmF0dXJl",
    state: "abc",
    next: "/new",
  });
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) p.delete(k);
    else p.set(k, v);
  }
  return p;
}

const urlOf = (p) => `${CB}?${p.toString()}`;

test("login URL", () => {
  const u = new URL(loginUrl(ORIGIN, `${CB}?state=abc`));
  assert.equal(`${u.origin}${u.pathname}`, STEAM_OP);
  assert.equal(u.searchParams.get("openid.mode"), "checkid_setup");
  assert.equal(u.searchParams.get("openid.realm"), ORIGIN);
  assert.equal(u.searchParams.get("openid.return_to"), `${CB}?state=abc`);
  assert.equal(u.searchParams.get("openid.claimed_id"), "http://specs.openid.net/auth/2.0/identifier_select");
});

test("good callback gives the steam id", () => {
  const p = steamAnswer();
  assert.deepEqual(checkCallbackParams(p, urlOf(p), CB), { steamId: ID });
});

test("bad callbacks are refused", () => {
  const cases = {
    "openid.mode": "cancel",
    "openid.op_endpoint": "https://evil.example/openid/login",
    "openid.claimed_id": "https://evil.example/openid/id/76561197960287930",
    "openid.identity": "https://steamcommunity.com/openid/id/76561197960287931",
    "openid.return_to": "https://evil.example/api/auth/callback?state=abc&next=%2Fnew",
    "openid.signed": "signed,op_endpoint,identity,return_to",
    "openid.sig": null,
    "openid.ns": "http://openid.net/signon/1.1",
  };
  for (const [k, v] of Object.entries(cases)) {
    const p = steamAnswer({ [k]: v });
    assert.ok(checkCallbackParams(p, urlOf(p), CB).error, k);
  }
  // return_to query differs from the URL actually called
  const p = steamAnswer({ next: "/evil" });
  assert.match(checkCallbackParams(p, urlOf(p), CB).error, /mismatch/);
  // called on another path
  const q = steamAnswer();
  assert.ok(checkCallbackParams(q, `${ORIGIN}/api/other?${q}`, CB).error);
  // claimed id with junk
  const r = steamAnswer({
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${ID}/x`,
    "openid.identity": `https://steamcommunity.com/openid/id/${ID}/x`,
  });
  assert.ok(checkCallbackParams(r, urlOf(r), CB).error);
});

test("a duplicated key is refused (checked value must be the one Steam verifies)", async () => {
  // Attacker's genuine assertion for their own id, with the victim's id put first.
  const victim = "https://steamcommunity.com/openid/id/76561198000000001";
  const p = new URLSearchParams([["openid.claimed_id", victim], ["openid.identity", victim], ...steamAnswer()]);
  assert.equal(p.get("openid.claimed_id"), victim);
  assert.match(checkCallbackParams(p, urlOf(p), CB).error, /duplicate/);
  let called = false;
  const ok = await verifyWithSteam(p, async () => {
    called = true;
    return new Response("is_valid:true\n");
  });
  assert.equal(ok, false);
  assert.equal(called, false);
  const q = steamAnswer();
  q.append("state", "abc");
  assert.match(checkCallbackParams(q, urlOf(q), CB).error, /duplicate/);
});

test("old or future response_nonce is refused", () => {
  const p = steamAnswer({ "openid.response_nonce": "2026-11-22T10:00:00Zabc" });
  const at = Date.parse("2026-11-22T10:00:00Z");
  assert.deepEqual(checkCallbackParams(p, urlOf(p), CB, at + 60 * 1000), { steamId: ID });
  assert.match(checkCallbackParams(p, urlOf(p), CB, at + 11 * 60 * 1000).error, /nonce/);
  assert.match(checkCallbackParams(p, urlOf(p), CB, at - 6 * 60 * 1000).error, /nonce/);
  for (const bad of ["abc", "", "2026-13-40T99:00:00Zx"]) {
    const q = steamAnswer({ "openid.response_nonce": bad });
    assert.match(checkCallbackParams(q, urlOf(q), CB).error, /nonce/, bad);
  }
});

test("check_authentication POST", async () => {
  const p = steamAnswer();
  let seen;
  const ok = await verifyWithSteam(p, async (url, init) => {
    seen = { url, init };
    return new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n", { status: 200 });
  });
  assert.equal(ok, true);
  assert.equal(seen.url, STEAM_OP);
  assert.equal(seen.init.method, "POST");
  const body = new URLSearchParams(seen.init.body);
  assert.equal(body.get("openid.mode"), "check_authentication");
  assert.equal(body.get("openid.sig"), "c2lnbmF0dXJl");
  assert.equal(body.get("state"), null, "only openid.* fields are sent");

  const no = (text, status = 200) => verifyWithSteam(p, async () => new Response(text, { status }));
  assert.equal(await no("ns:http://specs.openid.net/auth/2.0\nis_valid:false\n"), false);
  assert.equal(await no("is_valid:true", 500), false);
  assert.equal(await no("xis_valid:true"), false);
  assert.equal(await verifyWithSteam(p, async () => { throw new Error("network"); }), false);
});

test("profile from the Web API, then XML fallback, never throws", async () => {
  const api = await fetchProfile(ID, { STEAM_API_KEY: "k" }, async (url) => {
    assert.match(url, /GetPlayerSummaries/);
    return Response.json({ response: { players: [{ steamid: ID, personaname: "Karl\u0000 <b>", avatarfull: "https://avatars.steamstatic.com/abc_full.jpg" }] } });
  });
  assert.deepEqual(api, { name: "Karl <b>", avatar: "https://avatars.steamstatic.com/abc_full.jpg" });

  const xml = `<?xml version="1.0"?><profile><steamID64>${ID}</steamID64><steamID><![CDATA[Mr &amp; Dwarf]]></steamID>
    <avatarFull><![CDATA[https://avatars.akamai.steamstatic.com/abc_full.jpg]]></avatarFull></profile>`;
  const x = await fetchProfile(ID, {}, async (url) => {
    assert.match(url, /steamcommunity\.com\/profiles\/76561197960287930\/\?xml=1/);
    return new Response(xml);
  });
  assert.deepEqual(x, { name: "Mr & Dwarf", avatar: "https://avatars.akamai.steamstatic.com/abc_full.jpg" });

  assert.deepEqual(await fetchProfile(ID, {}, async () => { throw new Error("down"); }), { name: null, avatar: null });
  assert.deepEqual(await fetchProfile(ID, {}, async () => new Response("<html>", { status: 200 })), { name: null, avatar: null });
});

test("profile field cleaning", () => {
  assert.equal(cleanName("x".repeat(100)).length, 64);
  assert.equal(cleanName("   "), null);
  assert.equal(cleanAvatar("javascript:alert(1)"), null);
  assert.equal(cleanAvatar("https://evil.example/a.jpg"), null);
  assert.equal(cleanAvatar("https://avatars.steamstatic.com.evil.example/a.jpg"), null);
  assert.equal(cleanAvatar("https://avatars.steamstatic.com/a.jpg\"onerror=x"), null);
});
