// The game's loadout screens, shared by the editor (/new, /edit) and the build page (/b/<id>).
//   overview: gear cards (left: primary, secondary, pickaxe, flare; right: support tool, traversal,
//             throwable, armor), the perk column (editor: a click on a slot opens the perk panel next
//             to it, like the game), the class portrait, the class switcher and the main action.
//   mod:      one slot like the game's gear modification screen: item tabs, name, line art, stats box,
//             GEAR MODIFICATIONS (one row per tier, overclock grid, overclock block, pills) and CLOSE.
//             The grenade slot is the game's GRENADE SELECTION instead.
//
// model: { cls, slots: [{ item, tiers, oc }] in game.slots order,
//          perks: { passive: [id|0 per slot], active: [...], proficiency: [...] } }
// opts:  { edit, view: { name: "overview", perk: { type, i } } | { name: "mod", slot, oc: bool },
//          go(view), action: Node,
//          change: { item(slot, index), tier(slot, t, n), oc(slot, n), perk(type, i, id), classStep(dir) } }

import { h } from "./dom.js";
import { getGame, itemsOf, itemAt, ocAt, optionAt, perkById, slotName, img, PERK_TYPES } from "./game.js";
import {
  classIcon, mask, hex, ocIcon, setTip, itemTip, upgradeTip, ocTip, perkTip, textTip, button,
} from "./ui.js";
import { statsOf } from "./statsview.js";

const LEFT = ["primary", "secondary", "pickaxe"];
const RIGHT = ["tool", "traversal", "grenade", "armor"];
const PERK_PANEL = { passive: "Passive perks", active: "Active perks", proficiency: "Perk proficiency" };
const OC_NAME = { clean: "Clean overclock", balanced: "Balanced overclock", unstable: "Unstable overclock" };

function slotInfo(model, slot) {
  const g = getGame();
  const s = model.slots[g.slots.indexOf(slot)] || { item: 0, tiers: [], oc: 0 };
  const item = s.item ? itemAt(model.cls, slot, s.item) : null;
  const oc = item && s.oc ? ocAt(item, s.oc) : null;
  return { s, item, oc };
}

function chosenOption(item, s, t) {
  const n = s.tiers[t] || 0;
  return n ? optionAt(item.tiers[t], n) : null;
}

// One pill per upgrade option, the chosen ones bright (with the glyph when `glyphs`).
function pills(item, s, glyphs = false) {
  const row = h("div.pills");
  (item && item.tiers ? item.tiers : []).forEach((tier, t) => {
    tier.options.forEach((o, k) => {
      const on = (s.tiers[t] || 0) === (o.index || k + 1);
      const p = h("span.pill" + (on ? ".on" : "") + (k === 0 && t ? ".first" : ""));
      if (on && glyphs && o.icon) p.appendChild(mask(o.icon, null, "gl"));
      row.appendChild(p);
    });
  });
  return row;
}

// Big line art. The drawings have wide transparent margins, so the mask is zoomed to the drawing's
// own box (measured once per image) and the element takes its aspect ratio; CSS centres it.
const lineBoxes = new Map();
function lineBox(path) {
  if (!lineBoxes.has(path)) {
    lineBoxes.set(path, new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        try {
          const w = im.naturalWidth, ht = im.naturalHeight;
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = ht;
          const cx = cv.getContext("2d", { willReadFrequently: true });
          cx.drawImage(im, 0, 0);
          const d = cx.getImageData(0, 0, w, ht).data;
          let x0 = w, y0 = ht, x1 = -1, y1 = -1;
          for (let y = 0; y < ht; y++) {
            for (let x = 0; x < w; x++) {
              if (d[(y * w + x) * 4 + 3] > 40) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
              }
            }
          }
          resolve(x1 < 0 ? null : { w, h: ht, x0, y0, bw: x1 - x0 + 1, bh: y1 - y0 + 1 });
        } catch { resolve(null); }
      };
      im.onerror = () => resolve(null);
      im.src = img(path);
    }));
  }
  return lineBoxes.get(path);
}

function bigLine(path) {
  const el = mask(path, null, "sil big-line");
  lineBox(path).then((b) => {
    if (!b) return;
    const pos = (o, inner, full) => (inner >= full ? 0 : (o / (full - inner)) * 100);
    const size = `${(b.w / b.bw) * 100}% ${(b.h / b.bh) * 100}%`;
    const at = `${pos(b.x0, b.bw, b.w)}% ${pos(b.y0, b.bh, b.h)}%`;
    el.style.setProperty("--ar", String(b.bw / b.bh));
    el.style.setProperty("-webkit-mask-size", size);
    el.style.setProperty("mask-size", size);
    el.style.setProperty("-webkit-mask-position", at);
    el.style.setProperty("mask-position", at);
    el.classList.add("fit");
  });
  return el;
}

// ---------------------------------------------------------------- overview

function gearCard(model, slot, opts) {
  const { s, item, oc } = slotInfo(model, slot);
  const btn = h("button.gc.s-" + slot, { type: "button", "aria-label": `${slotName(slot)}: ${item ? item.name : "none"}`, onclick: () => opts.go({ name: "mod", slot }) });
  // The layout lives in an inner box over the whole button: older Chromium (the Steam overlay) does not give a
  // <button>'s own grid rows their height, so the picture row collapsed there.
  const card = h("div.gc-in");
  btn.appendChild(card);
  card.appendChild(h("div.gc-name" + (item ? "" : ".none"), { text: item ? item.name : `No ${slotName(slot)}` }));
  const pic = h("div.gc-pic", item ? mask(item.iconLine || item.icon, null, "sil") : null);
  if (item) setTip(pic, () => itemTip(item, slotName(slot)));
  if (oc) {
    const o = h("span.gc-oc", ocIcon(oc));
    setTip(o, () => ocTip(oc));
    pic.appendChild(o);
  }
  card.appendChild(pic);
  const hexes = h("div.gc-hexes");
  (item && item.tiers ? item.tiers : []).forEach((tier, t) => {
    const o = chosenOption(item, s, t);
    const cell = hex(o, false, "mini");
    if (o) setTip(cell, () => upgradeTip(o, t));
    hexes.appendChild(cell);
  });
  card.appendChild(hexes);
  card.appendChild(pills(item, s));
  return btn;
}

// The flare: not part of a build (one per class, no upgrades), shown like the game's card.
function flareCard(model) {
  const f = model.cls.flare;
  if (!f) return h("div.gc.flare");
  const pic = h("div.gc-pic", mask(f.iconLine || f.icon, null, "sil"));
  setTip(pic, () => itemTip(f, "Flare"));
  return h("div.gc.flare", h("div.gc-in", h("div.gc-name", { text: f.name }), pic, h("div.gc-hexes")));
}

function perkSlot(model, type, i, opts) {
  const id = (model.perks[type] || [])[i] || 0;
  const p = id ? perkById(id) : null;
  const sel = opts.view && opts.view.perk && opts.view.perk.type === type && opts.view.perk.i === i;
  const inner = [h("span.ps-bg"), p ? mask(p.icon, null, "ps-gl") : null];
  const el = opts.edit
    ? h("button.pslot." + type + (p ? ".full" : "") + (sel ? ".sel" : ""), {
      type: "button",
      "aria-label": `${PERK_PANEL[type]} slot ${i + 1}: ${p ? p.name : "empty"}`,
      "aria-expanded": sel ? "true" : "false",
      onclick: (e) => {
        e.stopPropagation();
        opts.go({ name: "overview", perk: sel ? null : { type, i } });
      },
    }, inner)
    : h("span.pslot." + type + (p ? ".full" : ""), inner);
  if (p) setTip(el, () => perkTip(p));
  return el;
}

function perkColumn(model, opts) {
  const g = getGame();
  const limits = g.perkSlots || { passive: 3, active: 2, proficiency: 1 };
  const col = h("div.pcol");
  col.appendChild(h("span.pcol-star", { "aria-hidden": "true" }));
  for (const t of PERK_TYPES) {
    for (let i = 0; i < (limits[t] || 0); i++) col.appendChild(perkSlot(model, t, i, opts));
  }
  return col;
}

// The game's perk list next to the column: a grid of icons, the first cell takes the perk out.
function perkPanel(model, opts) {
  const { type, i } = opts.view.perk;
  const g = getGame();
  const mine = model.perks[type] || [];
  const current = mine[i] || 0;
  const cells = [];
  const none = h("button.pp-cell.none" + (current ? "" : ".on"), {
    type: "button", "aria-label": "No perk", onclick: () => opts.change.perk(type, i, 0),
  });
  setTip(none, () => h("div.tip-head", h("div.tip-title", { text: "No perk" })));
  cells.push(none);
  for (const p of (g.perks || []).filter((x) => x.type === type)) {
    const at = mine.indexOf(p.id);
    const b = h("button.pp-cell." + type + (at === i ? ".on" : at >= 0 ? ".used" : ""), {
      type: "button", "aria-label": p.name + (at >= 0 && at !== i ? " (in another slot)" : ""),
      onclick: () => opts.change.perk(type, i, p.id),
    }, mask(p.icon, null, "pp-gl"));
    setTip(b, () => perkTip(p));
    cells.push(b);
  }
  return h("div.pp." + type, { onclick: (e) => e.stopPropagation() },
    h("div.pp-head", { text: PERK_PANEL[type] }),
    h("div.pp-grid", cells));
}

function classSwitch(model, opts) {
  const cls = model.cls;
  return h("div.switch", { style: { "--cls": `var(--c-${cls.key})` } },
    opts.edit ? h("button.sw-arrow.prev", { type: "button", "aria-label": "Previous class", onclick: () => opts.change.classStep(-1) }) : null,
    h("div.sw-name", classIcon(cls), h("span", { text: cls.name })),
    opts.edit ? h("button.sw-arrow.next", { type: "button", "aria-label": "Next class", onclick: () => opts.change.classStep(1) }) : null);
}

let escHandler = null;

function overview(model, opts) {
  const cls = model.cls;
  const open = !!(opts.edit && opts.view && opts.view.perk);
  if (open) {
    escHandler = (e) => {
      if (e.key === "Escape") opts.go({ name: "overview" });
    };
    document.addEventListener("keydown", escHandler);
  }
  const ov = h("div.ov" + (open ? ".pp-open" : ""),
    h("div.ov-left", LEFT.map((k) => gearCard(model, k, opts)), flareCard(model)),
    h("div.ov-perks", perkColumn(model, opts)),
    open ? h("div.ov-pp", perkPanel(model, opts)) : null,
    h("div.ov-mid",
      h("div.portrait", { style: { "--cls": `var(--c-${cls.key})` } },
        cls.portrait ? h("img", { src: img(cls.portrait), alt: cls.name, loading: "lazy" }) : classIcon(cls, "xl"))),
    h("div.ov-right", RIGHT.map((k) => gearCard(model, k, opts))),
    h("div.ov-switch", classSwitch(model, opts)),
    h("div.ov-action", opts.action || null));
  // A click anywhere else closes the perk panel, like the game.
  if (open) ov.addEventListener("click", () => opts.go({ name: "overview" }));
  return ov;
}

// ---------------------------------------------------------------- gear modification screen

// The chosen option (or null) of every tier of the item.
function chosenOf(item, s) {
  return ((item && item.tiers) || []).map((_, t) => chosenOption(item, s, t));
}

// Bottom right of the left area, like the game's stats box: the item's stats when the game data has
// them, then the chosen upgrades and the overclock as "+ name" lines.
function statsBox(item, s, oc, next = null) {
  const box = h("div.md-stats");
  if (!item) return box;
  const chosen = chosenOf(item, s);
  const st = statsOf(item, chosen, oc, next);
  if (st && st.rows.length) {
    box.appendChild(h("div.st-rows", st.rows.map((r) =>
      h("div.st-row" + (r.delta ? ".changed" : ""),
        h("span.st-label", { text: r.label + ":" }),
        r.delta ? h("span.st-delta" + (r.better === true ? ".good" : r.better === false ? ".bad" : ""), { text: r.delta }) : null,
        h("span.st-val", { text: r.text })))));
    for (const l of st.lines) box.appendChild(h("div.st-line.t-" + l.tone, { text: "+ " + l.text }));
    return box;
  }
  // No stats: the chosen upgrades and the overclock only (the description is in the name's tooltip).
  const named = chosen.filter(Boolean);
  if (named.length || oc) {
    const lines = h("div.st-lines");
    for (const o of named) lines.appendChild(h("div.st-line.t-upgrade", { text: "+ " + o.name }));
    if (oc) lines.appendChild(h("div.st-line.t-oc", { text: "+ " + oc.name }));
    box.appendChild(lines);
  }
  return box;
}

// The game's empty overclock slot: a dark upright hexagon with an orange rim.
function emptyOc() {
  return h("span.oc-empty", h("span.oc-empty-in"));
}

// The overclock block at the bottom of the panel (overclock mode): coloured head with name and type,
// icon, the stat lines. Hovering an overclock in the grid shows that one here, like the game.
// slotHover: shown while the slot is hovered; the icon place stays empty, the slot's own (enlarged) icon is
// seen there, like the game (no second copy of it).
function ocBlock(oc, edit, slotHover = false) {
  const icon = (node) => h("div.ocb-icon" + (slotHover ? ".slot-place" : ""), slotHover ? null : node);
  if (!oc) {
    // Like the game: a grey head and the empty slot hexagon.
    return h("div.ocb.empty",
      h("div.ocb-head.none", h("div.ocb-name", { text: "No overclock equipped" })),
      h("div.ocb-body", icon(emptyOc())));
  }
  const block = h("div.ocb." + oc.type,
    h("div.ocb-head", h("div.ocb-name", { text: oc.name }), h("div.ocb-type", { text: OC_NAME[oc.type] || "Overclock" })),
    h("div.ocb-body",
      icon(ocIcon(oc, "xl")),
      h("div.ocb-stats", (oc.stats || []).map((st) =>
        h("div.ocb-stat" + (st.good ? ".good" : ".bad"), h("span.tri"), h("span", { text: st.text }))))));
  if (!slotHover) setTip(block.querySelector(".ocb-icon"), () => ocTip(oc));
  return block;
}

// The game's overclock grid: every overclock of the item over the blurred tiers. Icons only; hovering
// shows the text in a tooltip and the overclock in the block below. A click equips it (a click on the
// equipped one takes it off) and closes the grid, like the game.
function ocGrid(item, slot, s, opts, preview) {
  const all = item.overclocks || [];
  const cells = all.map((o, k) => {
      const n = o.index || k + 1;
      const on = s.oc === n;
      const b = h("button.ocg-opt" + (on ? ".on" : ""), {
        type: "button", "aria-pressed": on ? "true" : "false", "aria-label": o.name,
        onclick: (e) => {
          e.stopPropagation();
          opts.change.oc(slot, on ? 0 : n);
          opts.go({ ...opts.view, oc: false });
        },
      }, ocIcon(o, "xl"));
      setTip(b, () => textTip(o.description));
      b.addEventListener("mouseenter", () => preview(o));
      b.addEventListener("mouseleave", () => preview(null));
      b.addEventListener("focus", () => preview(o));
      b.addEventListener("blur", () => preview(null));
      return b;
    });
  // Rows of three, full rows at the bottom: the short row is the top one, from the left.
  const short = all.length % 3;
  if (short) cells.splice(short, 0, ...Array.from({ length: 3 - short }, () => h("span.ocg-gap")));
  return h("div.md-ocgrid", h("div.ocg-list", cells));
}

function tierRows(item, slot, s, opts, onHover) {
  const edit = !!opts.edit;
  const rows = h("div.md-rows");
  const left = h("div.md-strip");
  (item && item.tiers ? item.tiers : []).forEach((tier, t) => {
    const chosen = chosenOption(item, s, t);
    const big = hex(chosen, false, "big");
    if (chosen) setTip(big, () => upgradeTip(chosen, t));
    left.appendChild(h("div.md-bigcell", big));
    const row = h("div.md-opts.n" + tier.options.length, tier.options.map((o, k) => {
      const n = o.index || k + 1;
      const on = (s.tiers[t] || 0) === n;
      const inner = [hex(o, on, "opt")];
      const b = edit
        ? h("button.mopt" + (on ? ".on" : ""), { type: "button", "aria-pressed": on ? "true" : "false", "aria-label": o.name, onclick: () => opts.change.tier(slot, t, on ? 0 : n) }, inner)
        : h("span.mopt" + (on ? ".on" : ""), inner);
      setTip(b, () => upgradeTip(o, t));
      b.addEventListener("mouseenter", () => onHover(t, o));
      b.addEventListener("mouseleave", () => onHover(t, null));
      return b;
    }));
    rows.appendChild(h("div.md-row", row));
  });
  if (item && !(item.tiers || []).length) rows.appendChild(h("div.md-none", { text: "This item has no upgrades." }));
  return h("div.md-body", left, rows);
}

// GRENADE SELECTION: the class's throwables as big hexagons in one column.
function grenadePanel(model, slot, item, opts) {
  const list = itemsOf(model.cls, slot);
  return h("div.md-panel.gren",
    h("div.md-head", h("div.md-title.solo", { text: "Grenade selection" })),
    h("div.gs-list", list.map((it) => {
      const on = it === item;
      const inner = h("span.gs-hex" + (on ? ".on" : ""), h("span.gs-bg"), mask(it.iconDetail || it.icon, null, "gs-gl" + (it.iconDetail ? " detail" : "")));
      const b = opts.edit
        ? h("button.gs-opt" + (on ? ".on" : ""), { type: "button", "aria-pressed": on ? "true" : "false", "aria-label": it.name, onclick: () => opts.change.item(slot, it.index) }, inner)
        : h("span.gs-opt" + (on ? ".on" : ""), inner);
      setTip(b, () => itemTip(it, slotName(slot)));
      return b;
    })));
}

// The overclock slot, fixed at the bottom of the strip (it does not scroll with the tiers), like the game:
// hovering shows the overclock block over the bottom of the panel, a click opens the overclock grid.
function ocSlot(oc, opts, hover) {
  const v = opts.view;
  const icon = oc ? ocIcon(oc, "xl") : emptyOc();
  const b = h("button.md-ocslot" + (v.oc ? ".on" : ""), {
    type: "button", "aria-pressed": v.oc ? "true" : "false",
    "aria-label": oc ? `Overclock: ${oc.name}` : opts.edit ? "Choose an overclock" : "No overclock",
    onclick: (e) => {
      e.stopPropagation();
      opts.go({ ...v, oc: !v.oc });
    },
  }, icon);
  b.addEventListener("mouseenter", () => hover(true));
  b.addEventListener("mouseleave", () => hover(false));
  return b;
}

function modPanel(model, slot, item, s, oc, opts, previewStats) {
  const view = opts.view;
  const hasOc = !!(item && (item.overclocks || []).length);
  const ocMode = hasOc && !!view.oc;
  const grid = ocMode && opts.edit;
  const head = h("div.md-head", h("span.md-more", { "aria-hidden": "true" }), h("div.md-title", { text: "Gear modifications" }));
  // Hover over the slot: the block lies over the bottom of the panel and lets the mouse through, so the
  // slot under it stays hovered and clickable. Overclock mode: the block sits under the grid.
  const hoverHost = h("div.ocb-hover");
  const modeHost = h("div.ocb-host");
  const preview = (o) => {
    modeHost.replaceChildren(ocBlock(o || oc, opts.edit));
    previewStats(o ? { chosen: chosenOf(item, s), oc: o } : null);
  };
  if (ocMode) {
    modeHost.appendChild(ocBlock(oc, opts.edit));
    modeHost.addEventListener("click", () => opts.go({ ...view, oc: false }));
  }
  const hover = (on) => {
    if (!ocMode) hoverHost.replaceChildren(...(on ? [ocBlock(oc, opts.edit, true)] : []));
  };
  const mid = h("div.md-mid" + (hasOc ? ".has-oc" : ""),
    tierRows(item, slot, s, opts, (t, o) => {
      if (!o) return previewStats(null);
      const chosen = chosenOf(item, s);
      chosen[t] = o;
      previewStats({ chosen, oc });
    }),
    hasOc && !ocMode ? ocSlot(oc, opts, hover) : null,
    hoverHost,
    grid ? ocGrid(item, slot, s, opts, preview) : null);
  if (grid) mid.addEventListener("click", (e) => {
    if (!e.target.closest(".ocg-opt")) opts.go({ ...view, oc: false });
  });
  return h("div.md-panel" + (grid ? ".ocmode" : ""), head, mid, ocMode ? modeHost : null, pills(item, s, true));
}

function modScreen(model, slot, opts) {
  const { s, item, oc } = slotInfo(model, slot);
  const view = opts.view;
  const grenade = slot === "grenade";
  if (view.oc) {
    escHandler = (e) => {
      if (e.key === "Escape") opts.go({ ...view, oc: false });
    };
    document.addEventListener("keydown", escHandler);
  }
  const list = opts.edit ? itemsOf(model.cls, slot) : (item ? [item] : []);
  // Item tabs (not for throwables: those are picked on the right, like the game).
  const tabs = h("div.md-tabs", grenade ? [] : list.map((it) => {
    const on = it === item;
    const t = h(opts.edit ? "button.md-tab" : "span.md-tab", {
      class: on ? "on" : null,
      type: opts.edit ? "button" : null,
      "aria-pressed": opts.edit ? (on ? "true" : "false") : null,
      "aria-label": it.name,
      onclick: opts.edit && !on ? () => opts.change.item(slot, it.index) : null,
    }, mask(it.icon || it.iconLine, null, "sil"));
    setTip(t, () => itemTip(it, slotName(slot)));
    return t;
  }));
  let statsEl = statsBox(item, s, oc);
  const previewStats = (o) => { // o: the previewed { chosen, oc }, or null
    const next = statsBox(item, s, oc, o);
    statsEl.replaceWith(next);
    statsEl = next;
  };
  const name = h("div.md-name", h("h2", { text: item ? item.name : `No ${slotName(slot)}` }), h("div.md-cat", { text: item ? item.category || slotName(slot) : slotName(slot) }));
  if (item) setTip(name, () => itemTip(item, slotName(slot)));
  const left = h("div.md-left",
    tabs,
    name,
    h("div.md-stage",
      h("div.md-pic", item ? bigLine(item.iconLine || item.icon) : null),
      statsEl));
  return h("div.md" + (grenade ? ".gren" : ""),
    left,
    grenade ? grenadePanel(model, slot, item, opts) : modPanel(model, slot, item, s, oc, opts, previewStats),
    h("div.md-bottom", button("CLOSE", { onclick: () => opts.go({ name: "overview" }) })));
}

// ---------------------------------------------------------------- entry

export function loadoutScreen(model, opts) {
  const v = opts.view || { name: "overview" };
  if (escHandler) document.removeEventListener("keydown", escHandler);
  escHandler = null;
  let body;
  if (v.name === "mod" && getGame().slots.includes(v.slot)) body = modScreen(model, v.slot, { ...opts, view: v });
  else body = overview(model, { ...opts, view: v });
  return h("div.ls", body);
}

// Height of the sticky site bar plus a gap: scroll targets go below it.
export function barHeight() {
  const bar = document.querySelector(".topbar");
  return (bar ? bar.offsetHeight : 56) + 8;
}

// Perk ids of a code -> { passive, active, proficiency } (unknown ids dropped).
export function perksByType(ids) {
  const out = { passive: [], active: [], proficiency: [] };
  for (const id of ids || []) {
    const p = perkById(id);
    if (p && out[p.type]) out[p.type].push(id);
  }
  return out;
}

// For the code: the perk lists without empty slots, passive then active then proficiency.
export function perkIds(perks) {
  return PERK_TYPES.flatMap((t) => (perks[t] || []).filter(Boolean));
}

