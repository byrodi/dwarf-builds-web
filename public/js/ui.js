// Shared widgets: tinted icons, upgrade hexagons, overclock and perk tiles, game-like tooltips,
// buttons, modals, clipboard.

import { h, clear, append } from "./dom.js";
import { getGame, maskUrl, classColourVar, ocFrame } from "./game.js";

// ---------------------------------------------------------------- icons

// A white PNG tinted with a colour (CSS mask).
export function mask(path, colour, cls = "") {
  return h("span.mask" + (cls ? "." + cls.split(" ").join(".") : ""), {
    style: { "--m": path ? maskUrl(path) : null, "--c": colour || null },
    "aria-hidden": "true",
  });
}

export function classIcon(cls, size = "") {
  return mask(cls && cls.icon, cls ? classColourVar(cls.letter) : null, "cls-icon" + (size ? " " + size : ""));
}

// line: the outline drawing (iconLine) for big pictures; else the filled silhouette (icon).
export function itemPic(item, colour, line = false) {
  return mask(item && ((line && item.iconLine) || item.icon), colour, "sil");
}

// Upgrade hexagon. option: an upgrade option or null; on: chosen.
export function hex(option, on, extra = "") {
  const el = h("span.hex" + (on ? ".on" : "") + (option ? "" : ".void") + (extra ? "." + extra : ""));
  append(el, [h("span.mask.bg"), h("span.mask.ol")]);
  if (option && option.icon) el.appendChild(mask(option.icon, null, "gl"));
  return el;
}

export function ocIcon(oc, size = "") {
  if (!oc) return h("span.oc.none" + (size ? "." + size : ""), h("span.bg.mask"));
  const fr = ocFrame(oc.type);
  return h("span.oc" + (size ? "." + size : ""),
    mask(fr.fill, null, "bg"),
    mask(fr.outline, `var(--${oc.type})`, "ol"),
    mask(oc.icon, null, "gl"));
}

export function perkTile(perk, size = "") {
  if (!perk) return h("span.perk.empty" + (size ? "." + size : ""), h("span.bg.mask"));
  return h("span.perk." + perk.type + (size ? "." + size : ""), h("span.bg.mask"), mask(perk.icon, null, "gl"));
}

// ---------------------------------------------------------------- rich text of perk descriptions

const TAGS = { h: "rt-h", hi: "rt-hi", active: "rt-active", passive: "rt-passive" };

// "<h>15 seconds</> ..." -> nodes. Unknown tags stay as text.
export function richText(text) {
  const out = [];
  const re = /<(h|hi|active|passive)>([\s\S]*?)<\/>/g;
  let last = 0;
  let m;
  const s = String(text || "");
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(document.createTextNode(s.slice(last, m.index)));
    out.push(h("span." + TAGS[m[1]], { text: m[2] }));
    last = re.lastIndex;
  }
  if (last < s.length) out.push(document.createTextNode(s.slice(last)));
  return out;
}

// ---------------------------------------------------------------- tooltips

const tips = new WeakMap();
let tipEl = null;
let tipOwner = null;
let touchMode = false;

export function setTip(el, build) {
  tips.set(el, build);
  el.setAttribute("data-tip", "");
  return el;
}

function tipBox({ tile, title, type, typeColour, body, rich, stats, extra }) {
  const head = h("div.tip-head",
    tile ? h("div.tip-tile" + (tile.plain ? ".plain" : "") + (tile.hex ? ".hex-tile" : ""), tile.node) : null,
    h("div",
      h("div.tip-title", { text: title }),
      type ? h("div.tip-type", { text: type, style: { color: typeColour || null } }) : null));
  const bodyEl = body ? h("div.tip-body", rich ? richText(body) : body) : null;
  const statEl = stats && stats.length
    ? h("div.tip-stats", stats.map((s) => h("div.stat" + (s.good ? "" : ".bad"), mask(null, null, "arrow"), h("span", { text: s.text }))))
    : null;
  const extraEl = extra ? h("div.tip-extra", { text: extra }) : null;
  return [head, bodyEl, statEl, extraEl];
}

export function itemTip(item, slotLabel) {
  return tipBox({
    tile: { node: mask(item.icon, null, "item-pic") },
    title: item.name,
    type: [slotLabel, item.category].filter(Boolean).join(" / "),
    body: item.description,
  });
}

// Only the text, like the game's tooltip over its overclock grid (the block below shows the rest).
export function textTip(text) {
  return h("div.tip-body", text || "");
}

export function upgradeTip(o, t) {
  // Like the game: an orange hexagon with the glyph, the name, the category, the text.
  return tipBox({
    tile: { node: mask(o.icon), hex: true },
    title: o.name,
    type: o.category || `Tier ${t + 1}`,
    body: o.description,
  });
}

export function ocTip(oc) {
  return tipBox({
    tile: { node: ocIcon(oc), plain: true },
    title: oc.name,
    type: `${oc.type} overclock`,
    typeColour: `var(--${oc.type})`,
    body: oc.description,
    stats: oc.stats,
  });
}

export function perkTip(p) {
  const kind = p.type === "proficiency" ? "Proficiency" : `${p.type} perk`;
  const bits = [];
  if (p.charges) bits.push(`Charges ${p.charges}`);
  return tipBox({
    tile: { node: perkTile(p, "lg"), plain: true },
    title: p.name,
    type: kind,
    typeColour: `var(--${p.type === "proficiency" ? "prof" : p.type})`,
    body: p.description,
    rich: true,
    extra: bits.join("   /   "),
  });
}

function showTip(owner, sheet) {
  const build = tips.get(owner);
  if (!build) return;
  if (!tipEl) tipEl = document.getElementById("tip");
  clear(tipEl);
  append(tipEl, [build()]);
  tipOwner = owner;
  tipEl.hidden = false;
  tipEl.classList.toggle("sheet", !!sheet);
  if (sheet) return;
  const r = owner.getBoundingClientRect();
  const w = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  // Above the hovered element, centred on it (beside it, it covered the stats box); below when there is no
  // room above.
  const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), Math.max(8, vw - w - 8));
  let y = r.top - th - 10;
  if (y < 8) y = r.bottom + 10;
  y = Math.min(Math.max(8, y), Math.max(8, vh - th - 8));
  tipEl.style.left = `${Math.round(x)}px`;
  tipEl.style.top = `${Math.round(y)}px`;
}

export function hideTip() {
  if (!tipEl) tipEl = document.getElementById("tip");
  if (tipEl) tipEl.hidden = true;
  tipOwner = null;
}

function tipTarget(node) {
  return node && node.closest ? node.closest("[data-tip]") : null;
}

export function initTips() {
  document.addEventListener("pointerdown", (e) => {
    touchMode = e.pointerType === "touch" || e.pointerType === "pen";
    if (touchMode && tipOwner && !tipTarget(e.target) && !(tipEl && tipEl.contains(e.target))) hideTip();
  }, true);
  document.addEventListener("mouseover", (e) => {
    if (touchMode) return;
    const t = tipTarget(e.target);
    if (t && t !== tipOwner) showTip(t, false);
    else if (!t && tipOwner) hideTip();
  });
  document.addEventListener("mouseleave", () => { if (!touchMode) hideTip(); });
  document.addEventListener("click", (e) => {
    if (!touchMode) return;
    const t = tipTarget(e.target);
    if (t) showTip(t, true);
    else if (tipEl && tipEl.contains(e.target)) hideTip();
  });
  window.addEventListener("scroll", () => { if (!touchMode && tipOwner) hideTip(); }, { passive: true });
}

// ---------------------------------------------------------------- buttons, modals

// Button like the game's CLOSE button. kind: "" (primary orange) or "sec", "danger"; size: "small", "big".
export function button(label, opts = {}) {
  const cls = ["btn", opts.kind, opts.size, opts.block ? "block" : "", opts.on ? "on" : ""].filter(Boolean).join(".");
  const inner = h("span", opts.icon || null, h("span.lbl", { text: label }));
  if (opts.href) {
    const a = h("a." + cls, { href: opts.href, title: opts.title }, inner);
    if (opts.link !== false) a.setAttribute("data-link", "");
    return a;
  }
  return h("button." + cls, { type: "button", onclick: opts.onclick, disabled: opts.disabled, title: opts.title }, inner);
}

export function setLabel(btn, label) {
  const l = btn.querySelector(".lbl");
  if (l) l.textContent = label;
}

let openModal = null;

// Simple modal. Returns a promise of the button value (or null when closed).
export function modal({ title, body, buttons, wide = false }) {
  if (openModal) openModal(null);
  return new Promise((resolve) => {
    let done = false;
    const back = h("div.modal-back");
    const close = (v) => {
      if (done) return;
      done = true;
      openModal = null;
      document.removeEventListener("keydown", onKey);
      back.remove();
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(null);
    };
    const box = h("div.modal" + (wide ? ".wide" : ""), { role: "dialog", "aria-modal": "true" },
      h("h3", { text: title }),
      body,
      h("div.actions", buttons.map((b) => button(b.label, { kind: b.kind, size: "small", onclick: () => close(b.value) }))));
    back.appendChild(box);
    back.addEventListener("mousedown", (e) => {
      if (e.target === back) close(null);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    openModal = close;
    const first = box.querySelector("textarea, input, .btn:last-child");
    if (first) first.focus();
  });
}

export function confirmModal(title, text, yes = "YES", kind = "") {
  return modal({
    title,
    body: h("p", { text }),
    buttons: [{ label: "CANCEL", kind: "sec", value: false }, { label: yes, kind, value: true }],
  }).then((v) => !!v);
}

export function closeModal() {
  if (openModal) openModal(null);
}

// ---------------------------------------------------------------- clipboard

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall back below
  }
  const ta = h("textarea", { readonly: true, style: { position: "fixed", left: "-9999px", top: "0", opacity: "0" } });
  ta.value = text;
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

// Copy button with a short "COPIED" state.
export function copyButton(getText, opts = {}) {
  const label = opts.label || "COPY CODE";
  let timer = 0;
  const btn = button(label, {
    ...opts,
    onclick: async () => {
      const ok = await copyText(getText());
      clearTimeout(timer);
      btn.classList.toggle("copied", ok);
      setLabel(btn, ok ? "COPIED" : "PRESS CTRL+C");
      timer = setTimeout(() => {
        btn.classList.remove("copied");
        setLabel(btn, label);
      }, 1600);
      if (opts.after) opts.after(ok);
    },
  });
  return btn;
}

// ---------------------------------------------------------------- states

export function loadingState(text = "LOADING") {
  return h("div.state.state-loading", h("span.spinner", { "aria-hidden": "true" }), h("span", { text }));
}

export function errorState(title, text, actions) {
  return h("div.state", h("h2", { text: title }), text ? h("p", { text }) : null, actions ? h("div.actions", actions) : null);
}

export function avatar(user, big = false) {
  const cls = "avatar" + (big ? ".big" : "");
  if (user && user.avatar && /^https:\/\//.test(user.avatar)) {
    return h("img." + cls, { src: user.avatar, alt: "", referrerpolicy: "no-referrer", loading: "lazy" });
  }
  const letter = (user && user.name ? Array.from(user.name.trim())[0] || "?" : "?").toUpperCase();
  return h("span." + cls, { text: letter, "aria-hidden": "true" });
}

export function gameData() {
  return getGame();
}
