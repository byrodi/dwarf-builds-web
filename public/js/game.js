// Game data (data/game.json, made by Tools/dwarfbuilds_export.py) and lookups by id.

let promise = null;
let game = null;
const itemIndex = new Map(); // item id (lower case) -> { cls, slot, item }

const CLASS_COLOURS = { D: "--c-driller", E: "--c-engineer", G: "--c-gunner", S: "--c-scout" };

export function img(path) {
  if (!path) return "";
  return /^https?:\/\//.test(path) ? path : "/" + String(path).replace(/^\/+/, "");
}

export function maskUrl(path) {
  return `url("${img(path)}")`;
}

export function loadGame() {
  if (!promise) {
    promise = fetch("/data/game.json", { credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
        return r.json();
      })
      .then((g) => {
        game = g;
        prepare(g);
        return g;
      })
      .catch((e) => {
        promise = null;
        throw e;
      });
  }
  return promise;
}

export function getGame() {
  return game;
}

function prepare(g) {
  const root = document.documentElement.style;
  const f = g.frames || {};
  const vars = {
    "--f-upg-bg": f.upgBg,
    "--f-upg-ol": f.upgOutline,
    "--f-perk-active": f.perkActiveFill,
    "--f-perk-active-ol": f.perkActiveOutline,
    "--f-prof": f.profFrame,
    "--f-arrow": f.statArrow,
  };
  for (const [k, v] of Object.entries(vars)) if (v) root.setProperty(k, maskUrl(v));
  const c = g.colors || {};
  const colours = {
    "--clean": c.clean, "--balanced": c.balanced, "--unstable": c.unstable,
    "--passive": c.passive, "--active": c.active, "--prof": c.proficiency,
    "--orange": c.orange, "--good": c.statGood, "--bad": c.statBad, "--text-h": c.textH,
  };
  for (const [k, v] of Object.entries(colours)) if (/^#[0-9a-f]{6}$/i.test(v || "")) root.setProperty(k, v);

  itemIndex.clear();
  for (const cls of g.classes || []) {
    for (const slot of g.slots || []) {
      for (const item of (cls.slots && cls.slots[slot]) || []) {
        itemIndex.set(String(item.id).toLowerCase(), { cls, slot, item });
      }
    }
  }
}

export function classColourVar(letter) {
  return `var(${CLASS_COLOURS[letter] || "--orange"})`;
}

export function classByLetter(letter) {
  return (game.classes || []).find((c) => c.letter === letter) || null;
}

export function classByKey(key) {
  const k = String(key || "").toLowerCase();
  return (game.classes || []).find((c) => c.key === k || c.letter.toLowerCase() === k) || null;
}

export function slotName(slot) {
  return (game.slotNames && game.slotNames[slot]) || slot;
}

export function itemById(id) {
  if (!id) return null;
  const hit = itemIndex.get(String(id).toLowerCase());
  return hit ? hit.item : null;
}

export function ocOf(item, id) {
  if (!item || !id) return null;
  const k = String(id).toLowerCase();
  return (item.overclocks || []).find((o) => String(o.id).toLowerCase() === k) || null;
}

export function itemsOf(cls, slot) {
  return (cls && cls.slots && cls.slots[slot]) || [];
}

export function itemAt(cls, slot, index) {
  const list = itemsOf(cls, slot);
  return list.find((it) => it.index === index) || list[index - 1] || null;
}

export function optionAt(tier, n) {
  const opts = (tier && tier.options) || [];
  return opts.find((o) => o.index === n) || opts[n - 1] || null;
}

export function ocAt(item, n) {
  const ocs = (item && item.overclocks) || [];
  return ocs.find((o) => o.index === n) || ocs[n - 1] || null;
}

export function perkById(id) {
  return (game.perks || []).find((p) => p.id === id) || null;
}

export const OC_TYPES = ["clean", "balanced", "unstable"];
export const PERK_TYPES = ["passive", "active", "proficiency"];
export const GEAR_LABELS = { traversal: "TRAVERSAL", tool: "SUPPORT", armor: "ARMOR", grenade: "GRENADE" };

export function ocFrame(type) {
  const f = game.frames || {};
  const key = type === "clean" ? "ocClean" : type === "unstable" ? "ocUnstable" : "ocBalanced";
  return { outline: f[key], fill: f[key + "Fill"] || f[key] };
}
