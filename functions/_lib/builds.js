// Build helpers shared by the API routes.

import { validateBuild, buildFromJson } from "../../public/js/shared/code.js";
import { HttpError, cleanText } from "./http.js";
import { findProfanity } from "./profanity.js";

export const PAGE_SIZE = 24;
// OFFSET paging reads every skipped row: deep pages cost D1 reads (free plan), so stop at 50.
export const MAX_PAGE = 50;
export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 4000;
export const REASON_MAX = 500;
export const BUILDS_PER_DAY = 20;
export const REPORTS_PER_DAY = 30;
// All writes of one user per UTC day (create, edit, like toggle, report): keeps one account from
// using up the D1 free-plan row writes for everyone.
export const WRITES_PER_DAY = 500;

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function newId(len = 8) {
  let out = "";
  while (out.length < len) {
    const bytes = crypto.getRandomValues(new Uint8Array(len * 2));
    for (const b of bytes) {
      if (b < 248 && out.length < len) out += BASE62[b % 62]; // 248 = 4 * 62: no bias
    }
  }
  return out;
}

export function isBuildId(s) {
  return typeof s === "string" && /^[0-9A-Za-z]{8}$/.test(s);
}

export function displayName(name, steamId) {
  return name || `Dwarf ${String(steamId).slice(-4)}`;
}

export function author(row) {
  return { steamId: row.user_id, name: displayName(row.author_name, row.user_id), avatar: row.author_avatar || null };
}

// Card for lists.
export function card(row) {
  return {
    id: row.id,
    class: row.class,
    title: row.title,
    code: row.code,
    primaryItem: row.primary_item || null,
    secondaryItem: row.secondary_item || null,
    primaryOc: row.primary_oc || null,
    secondaryOc: row.secondary_oc || null,
    likes: row.likes,
    hidden: !!row.hidden,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: author(row),
  };
}

export const CARD_COLUMNS = `b.id, b.user_id, b.class, b.title, b.code, b.primary_item, b.secondary_item,
  b.primary_oc, b.secondary_oc, b.likes, b.hidden, b.created_at, b.updated_at,
  u.name AS author_name, u.avatar AS author_avatar`;

// Public text: cleanText, and no profanity.
function publicText(value, options) {
  const s = cleanText(value, options);
  const bad = findProfanity(s);
  if (bad) throw new HttpError(400, `${options.name} has a word that is not allowed: "${bad}"`);
  return s;
}

// Checks {title, description, code}. Returns the values to store.
export function parseBuildBody(body, gameData) {
  const title = publicText(body.title, { max: TITLE_MAX, required: true, name: "title" });
  const description = publicText(body.description, { max: DESCRIPTION_MAX, multiline: true, name: "description" });
  if (typeof body.code !== "string" || !body.code.trim()) throw new HttpError(400, "code is required");
  const v = validateBuild(body.code, gameData);
  if (!v.ok) throw new HttpError(400, `invalid build: ${v.errors.slice(0, 5).join("; ")}`);
  const j = v.buildJson;
  return {
    title,
    description,
    code: v.canonical,
    class: j.class,
    buildJson: JSON.stringify(j),
    primaryItem: j.slots.primary ? j.slots.primary.item : null,
    secondaryItem: j.slots.secondary ? j.slots.secondary.item : null,
    primaryOc: j.slots.primary ? j.slots.primary.oc : null,
    secondaryOc: j.slots.secondary ? j.slots.secondary.oc : null,
    dataVersion: String(gameData.version || ""),
  };
}

// Code for display: rebuilt from build_json when game data changed since the build was saved.
export function currentCode(row, gameData) {
  if (!gameData || !row.build_json || row.data_version === String(gameData.version || "")) {
    return { code: row.code, rebuilt: false, missing: [] };
  }
  try {
    const r = buildFromJson(JSON.parse(row.build_json), gameData);
    if (r.code) return { code: r.code, rebuilt: r.code !== row.code, missing: r.missing };
  } catch {
    // fall through
  }
  return { code: row.code, rebuilt: false, missing: [] };
}

export async function getUserRow(env, steamId) {
  return env.DB.prepare("SELECT steam_id, name, avatar, banned, created_at FROM users WHERE steam_id = ?")
    .bind(steamId)
    .first();
}

// The signed-in user must exist, not be banned and have writes left today. Only on writes: one
// statement that counts the write (no row is written once the budget is used up).
export async function requireActiveUser(env, user, now = Date.now()) {
  if (!user) throw new HttpError(401, "sign in first");
  const day = Math.floor(now / 86400000);
  const row = await env.DB.prepare(
    `UPDATE users SET write_count = CASE WHEN write_day = ?2 THEN write_count + 1 ELSE 1 END, write_day = ?2
     WHERE steam_id = ?1 AND NOT (write_day = ?2 AND write_count >= ?3)
     RETURNING steam_id, name, avatar, banned, created_at`
  )
    .bind(user.steamId, day, WRITES_PER_DAY)
    .first();
  if (!row) {
    if (!(await getUserRow(env, user.steamId))) throw new HttpError(401, "sign in first");
    throw new HttpError(429, "too many changes today, try again tomorrow");
  }
  if (row.banned) throw new HttpError(403, "account is banned");
  return row;
}

export async function upsertUser(env, steamId, profile) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (steam_id, name, avatar, created_at, updated_at, banned) VALUES (?1, ?2, ?3, ?4, ?4, 0)
     ON CONFLICT(steam_id) DO UPDATE SET
       name = COALESCE(excluded.name, users.name),
       avatar = COALESCE(excluded.avatar, users.avatar),
       updated_at = excluded.updated_at`
  )
    .bind(steamId, profile.name, profile.avatar, now)
    .run();
}

// LIKE pattern for a title search; escapes the wildcards.
export function likePattern(q) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function parsePage(v) {
  const n = parseInt(v || "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_PAGE);
}
