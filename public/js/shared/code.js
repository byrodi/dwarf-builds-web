// Dwarf Builds build code DB1 (see Docs/dwarfbuilds-site.md, section 1).
// Isomorphic ES module: used by the browser and by Pages Functions. No dependencies.
//
//   DB1:<class>:<p0>:<p1>:<p2>:<p3>:<p4>:<p5>:<p6>:<perks>
//   p = <item>-<tiers>-<oc>, perks = ids joined with "."
//
// A build object is { class: "D", slots: [{ item, tiers: [..], oc } x7], perks: [ids] }.
// Readers ignore extra parts/digits and treat missing ones as 0.

export const PREFIX = "DB1";
export const CLASS_LETTERS = ["D", "E", "G", "S"];
export const SLOT_KEYS = ["primary", "secondary", "traversal", "tool", "armor", "grenade", "pickaxe"];
export const PERK_TYPES = ["passive", "active", "proficiency"];
export const DEFAULT_PERK_SLOTS = { passive: 3, active: 2, proficiency: 1 };
export const MAX_CODE_LENGTH = 400;

const ALLOWED = /^[A-Z0-9:.\-]*$/;

function toInt(s) {
  // Digits only; anything else (or empty) is 0. Caps the value so huge numbers stay safe.
  if (typeof s !== "string" || !/^[0-9]{1,6}$/.test(s)) return 0;
  return parseInt(s, 10);
}

export function emptySlot() {
  return { item: 0, tiers: [], oc: 0 };
}

export function emptyBuild(letter = "") {
  return { class: letter, slots: SLOT_KEYS.map(emptySlot), perks: [] };
}

// Parses a code. Returns a build object, or null when the text is not a valid build code.
export function parseCode(code) {
  if (typeof code !== "string") return null;
  const text = code.trim().toUpperCase();
  if (!text || text.length > MAX_CODE_LENGTH || !ALLOWED.test(text)) return null;
  const parts = text.split(":");
  if (parts[0] !== PREFIX) return null;
  const letter = parts[1] || "";
  if (!CLASS_LETTERS.includes(letter)) return null;
  const build = emptyBuild(letter);
  for (let i = 0; i < SLOT_KEYS.length; i++) {
    const p = (parts[2 + i] || "").split("-");
    const tierText = p[1] || "";
    build.slots[i] = {
      item: toInt(p[0] || ""),
      tiers: tierText.split("").map((ch) => (ch >= "0" && ch <= "9" ? ch.charCodeAt(0) - 48 : 0)),
      oc: toInt(p[2] || ""),
    };
  }
  const perkText = parts[2 + SLOT_KEYS.length] || "";
  build.perks = perkText ? perkText.split(".").map(toInt).filter((n) => n > 0) : [];
  if (!build.slots.some((s) => s.item > 0)) return null;
  return build;
}

// Why parseCode rejects a text (for error messages); null when it parses.
export function codeProblem(code) {
  if (typeof code !== "string" || !code.trim()) return "empty";
  const text = code.trim().toUpperCase();
  if (text.length > MAX_CODE_LENGTH) return `longer than ${MAX_CODE_LENGTH} characters`;
  if (!ALLOWED.test(text)) return "only A-Z 0-9 : - . are allowed";
  const parts = text.split(":");
  if (parts[0] !== PREFIX) return `must start with ${PREFIX}:`;
  if (!CLASS_LETTERS.includes(parts[1] || "")) return `unknown class "${parts[1] || ""}"`;
  return parseCode(text) ? null : "no item";
}

// Formats a build object as a code. No checks against game data; see validateBuild for the
// canonical form.
export function encodeCode(build) {
  const letter = String((build && build.class) || "").toUpperCase();
  const slots = (build && Array.isArray(build.slots) ? build.slots : []);
  const parts = [PREFIX, letter];
  for (let i = 0; i < SLOT_KEYS.length; i++) {
    const s = slots[i] || emptySlot();
    const tiers = (Array.isArray(s.tiers) ? s.tiers : []).map((t) => String(clampDigit(t))).join("");
    parts.push(`${nonNeg(s.item)}-${tiers}-${nonNeg(s.oc)}`);
  }
  const perks = (build && Array.isArray(build.perks) ? build.perks : []).map(nonNeg).filter((n) => n > 0);
  parts.push(perks.join("."));
  return parts.join(":");
}

function nonNeg(n) {
  n = Number(n);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function clampDigit(n) {
  n = Number(n);
  return Number.isInteger(n) && n > 0 && n <= 9 ? n : 0;
}

// ---- game data helpers -----------------------------------------------------------------------

const indexCache = new WeakMap();

function indexOf(gameData) {
  let idx = indexCache.get(gameData);
  if (idx) return idx;
  const classes = new Map();
  for (const c of gameData.classes || []) classes.set(c.letter, c);
  const perksById = new Map();
  const perksByAsset = new Map();
  for (const p of gameData.perks || []) {
    perksById.set(p.id, p);
    perksByAsset.set(p.asset, p);
  }
  idx = { classes, perksById, perksByAsset };
  indexCache.set(gameData, idx);
  return idx;
}

function slotKeys(gameData) {
  return Array.isArray(gameData.slots) && gameData.slots.length === SLOT_KEYS.length ? gameData.slots : SLOT_KEYS;
}

export function classByLetter(gameData, letter) {
  return indexOf(gameData).classes.get(String(letter || "").toUpperCase()) || null;
}

// slot: key ("primary") or position 0..6. index: 1-based item index.
export function itemBySlot(gameData, letter, slot, index) {
  const c = classByLetter(gameData, letter);
  if (!c) return null;
  const key = typeof slot === "number" ? slotKeys(gameData)[slot] : slot;
  const list = (c.slots && c.slots[key]) || [];
  return list.find((it) => it.index === index) || list[index - 1] || null;
}

export function perkById(gameData, id) {
  return indexOf(gameData).perksById.get(id) || null;
}

export function perkByAsset(gameData, asset) {
  return indexOf(gameData).perksByAsset.get(asset) || null;
}

function optionAt(tier, n) {
  const opts = (tier && tier.options) || [];
  return opts.find((o) => o.index === n) || opts[n - 1] || null;
}

function ocAt(item, n) {
  const ocs = item.overclocks || [];
  return ocs.find((o) => o.index === n) || ocs[n - 1] || null;
}

// ---- validation ------------------------------------------------------------------------------

// build: a build object or a code string.
// Returns { ok, errors[], build (canonical object), canonical (code), buildJson }.
export function validateBuild(build, gameData) {
  const errors = [];
  const fail = (msg) => ({ ok: false, errors: [msg], build: null, canonical: null, buildJson: null });
  if (typeof build === "string") {
    const parsed = parseCode(build);
    if (!parsed) return fail(`not a valid ${PREFIX} code (${codeProblem(build)})`);
    build = parsed;
  }
  if (!build || typeof build !== "object") return fail("no build");
  if (!gameData || !Array.isArray(gameData.classes)) return fail("no game data");
  const letter = String(build.class || "").toUpperCase();
  const cls = classByLetter(gameData, letter);
  if (!cls) return fail(`unknown class "${letter}"`);

  const keys = slotKeys(gameData);
  const out = emptyBuild(letter);
  const json = { class: letter, slots: {}, perks: [] };
  const inSlots = Array.isArray(build.slots) ? build.slots : [];
  let anyItem = false;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const s = inSlots[i] || emptySlot();
    const itemIndex = nonNeg(s.item);
    json.slots[key] = null;
    if (!itemIndex) continue;
    const item = itemBySlot(gameData, letter, key, itemIndex);
    if (!item) {
      errors.push(`${key}: no item ${itemIndex}`);
      continue;
    }
    anyItem = true;
    const tiers = [];
    const tierIds = [];
    const inTiers = Array.isArray(s.tiers) ? s.tiers : [];
    (item.tiers || []).forEach((tier, t) => {
      const n = clampDigit(inTiers[t]); // extra digits are ignored, missing ones are 0
      if (n && !optionAt(tier, n)) {
        errors.push(`${key}: tier ${t + 1} has no option ${n}`);
        tiers.push(0);
        tierIds.push(null);
        return;
      }
      tiers.push(n);
      tierIds.push(n ? optionAt(tier, n).id : null);
    });
    let oc = nonNeg(s.oc);
    let ocId = null;
    if (oc) {
      const o = ocAt(item, oc);
      if (!o) {
        errors.push(`${key}: no overclock ${oc}`);
        oc = 0;
      } else ocId = o.id;
    }
    out.slots[i] = { item: itemIndex, tiers, oc };
    json.slots[key] = { item: item.id, tiers: tierIds, oc: ocId };
  }
  if (!anyItem) errors.push("no items");

  // Perks: known ids, no duplicates, at most perkSlots of each type; canonical order by type.
  const limits = Object.assign({}, DEFAULT_PERK_SLOTS, gameData.perkSlots || {});
  const byType = { passive: [], active: [], proficiency: [] };
  const seen = new Set();
  for (const raw of Array.isArray(build.perks) ? build.perks : []) {
    const id = nonNeg(raw);
    const perk = id ? perkById(gameData, id) : null;
    if (!perk || !byType[perk.type]) {
      errors.push(`unknown perk ${raw}`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`perk ${perk.asset} twice`);
      continue;
    }
    seen.add(id);
    byType[perk.type].push(perk);
  }
  for (const t of PERK_TYPES) {
    if (byType[t].length > limits[t]) {
      errors.push(`too many ${t} perks (${byType[t].length} > ${limits[t]})`);
      byType[t] = byType[t].slice(0, limits[t]);
    }
  }
  for (const t of PERK_TYPES) {
    for (const p of byType[t]) {
      out.perks.push(p.id);
      json.perks.push(p.asset);
    }
  }

  const ok = errors.length === 0;
  return {
    ok,
    errors,
    build: anyItem ? out : null,
    canonical: anyItem ? encodeCode(out) : null,
    buildJson: anyItem ? json : null,
  };
}

// Rebuilds a code from stored asset names (after a game data update).
// Returns { code, build, missing[] } (code is null when no item is left).
export function buildFromJson(buildJson, gameData) {
  const missing = [];
  const letter = String((buildJson && buildJson.class) || "").toUpperCase();
  const cls = classByLetter(gameData, letter);
  if (!cls) return { code: null, build: null, missing: [`class ${letter}`] };
  const keys = slotKeys(gameData);
  const out = emptyBuild(letter);
  const slots = (buildJson && buildJson.slots) || {};
  keys.forEach((key, i) => {
    const s = slots[key];
    if (!s || !s.item) return;
    const list = (cls.slots && cls.slots[key]) || [];
    const pos = list.findIndex((it) => it.id === s.item);
    if (pos < 0) {
      missing.push(`${key} ${s.item}`);
      return;
    }
    const item = list[pos];
    const tiers = (item.tiers || []).map(() => 0);
    (Array.isArray(s.tiers) ? s.tiers : []).forEach((uid, t) => {
      if (!uid) return;
      // Same tier first; if the upgrade moved to another tier, take it there.
      let at = t;
      let o = item.tiers && item.tiers[t] ? item.tiers[t].options.find((x) => x.id === uid) : null;
      if (!o) {
        at = (item.tiers || []).findIndex((tier) => tier.options.some((x) => x.id === uid));
        o = at >= 0 ? item.tiers[at].options.find((x) => x.id === uid) : null;
      }
      if (!o || tiers[at]) {
        missing.push(`${key} upgrade ${uid}`);
        return;
      }
      tiers[at] = o.index || item.tiers[at].options.indexOf(o) + 1;
    });
    let oc = 0;
    if (s.oc) {
      const ocs = item.overclocks || [];
      const o = ocs.find((x) => x.id === s.oc);
      if (o) oc = o.index || ocs.indexOf(o) + 1;
      else missing.push(`${key} overclock ${s.oc}`);
    }
    out.slots[i] = { item: item.index || pos + 1, tiers, oc };
  });
  for (const asset of (buildJson && buildJson.perks) || []) {
    const p = perkByAsset(gameData, asset);
    if (p) out.perks.push(p.id);
    else missing.push(`perk ${asset}`);
  }
  const v = validateBuild(out, gameData);
  return { code: v.canonical, build: v.build, missing: missing.concat(v.ok ? [] : v.errors) };
}

// Short label for a code, e.g. for the clipboard banner: { className, primary }.
export function describeCode(code, gameData) {
  const b = typeof code === "string" ? parseCode(code) : code;
  if (!b) return null;
  const c = classByLetter(gameData, b.class);
  const p = b.slots[0].item ? itemBySlot(gameData, b.class, 0, b.slots[0].item) : null;
  return { className: c ? c.name : b.class, primary: p ? p.name : "" };
}
