import test from "node:test";
import assert from "node:assert/strict";
import {
  signSession,
  verifySession,
  currentUser,
  readCookie,
  sessionCookie,
  clearCookie,
  isAdmin,
  isSteamId,
} from "../functions/_lib/session.js";

const SECRET = "test-secret-for-unit-tests";
const ID = "76561197960287930";
const NOW = 1_800_000_000;

test("sign and verify", async () => {
  const v = await signSession(ID, SECRET, NOW);
  const [id, exp, sig] = v.split(".");
  assert.equal(id, ID);
  assert.equal(Number(exp), NOW + 30 * 86400);
  assert.match(sig, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await verifySession(v, SECRET, NOW + 10), { steamId: ID, expiry: NOW + 30 * 86400 });
});

test("expired session is rejected", async () => {
  const v = await signSession(ID, SECRET, NOW);
  assert.equal(await verifySession(v, SECRET, NOW + 30 * 86400), null);
  assert.equal(await verifySession(v, SECRET, NOW + 31 * 86400), null);
});

test("tampered sessions are rejected", async () => {
  const v = await signSession(ID, SECRET, NOW);
  const [id, exp, sig] = v.split(".");
  const other = "76561197960287931";
  const flip = sig.slice(0, -2) + (sig.at(-2) === "A" ? "B" : "A") + sig.at(-1);
  for (const bad of [
    `${other}.${exp}.${sig}`,
    `${id}.${Number(exp) + 1000}.${sig}`,
    `${id}.${exp}.${flip}`,
    `${id}.${exp}.`,
    `${id}.${exp}`,
    `${id}.${exp}.${sig}.x`,
    `${id}.${exp}.${sig}==`,
    `12345.${exp}.${sig}`,
    "",
    "garbage",
  ]) {
    assert.equal(await verifySession(bad, SECRET, NOW), null, bad);
  }
  assert.equal(await verifySession(v, "another-secret", NOW), null, "other secret");
  assert.equal(await verifySession(null, SECRET, NOW), null);
});

test("no secret: signing fails, nobody is signed in", async () => {
  await assert.rejects(() => signSession(ID, "", NOW));
  const req = new Request("https://x.test/api/me", { headers: { Cookie: `db_session=${await signSession(ID, SECRET)}` } });
  assert.equal(await currentUser(req, {}), null);
});

test("currentUser from cookie and admins", async () => {
  const v = await signSession(ID, SECRET);
  const req = new Request("https://x.test/api/me", { headers: { Cookie: `a=b; db_session=${v}; c=d` } });
  assert.deepEqual(await currentUser(req, { SESSION_SECRET: SECRET }), { steamId: ID, admin: false });
  assert.deepEqual(await currentUser(req, { SESSION_SECRET: SECRET, ADMIN_STEAM_IDS: ` 1, ${ID} ` }), { steamId: ID, admin: true });
  assert.equal(isAdmin({}, ID), false);
  assert.equal(readCookie(req, "c"), "d");
  assert.equal(readCookie(req, "zz"), null);
});

test("cookie attributes", () => {
  const https = new Request("https://dwarfbuilds.pages.dev/");
  const c = sessionCookie(https, "v");
  assert.match(c, /^db_session=v; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
  assert.doesNotMatch(sessionCookie(new Request("http://localhost:8788/"), "v"), /Secure/);
  assert.match(clearCookie(https), /^db_session=; Max-Age=0;/);
});

test("steam id shape", () => {
  assert.ok(isSteamId(ID));
  assert.ok(!isSteamId("7656119796028793"));
  assert.ok(!isSteamId("86561197960287930"));
  assert.ok(!isSteamId(76561197960287930));
});
