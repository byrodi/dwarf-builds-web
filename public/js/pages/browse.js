// "/" browse: class tabs, weapon and overclock filters, sort NEW / TOP, title search, paged cards.

import { h, mount } from "../dom.js";
import { api, errorText } from "../api.js";
import { getGame, classByKey, itemById } from "../game.js";
import { classIcon, itemPic, ocIcon, ocTip, setTip, button, loadingState, errorState } from "../ui.js";
import { cardGrid, pager } from "../cards.js";

const WEAPON_SLOTS = ["primary", "secondary"];

export async function browsePage(ctx) {
  const g = getGame();
  const q = ctx.query;
  const weaponsOf = (c) => WEAPON_SLOTS.flatMap((s) => c.slots[s] || []);
  // overclock id -> { cls, weapon, oc } (the filter picks one overclock of one weapon)
  const ocs = new Map();
  for (const c of g.classes) for (const w of weaponsOf(c)) for (const o of w.overclocks || []) ocs.set(o.id, { cls: c, weapon: w, oc: o });
  const classOf = (itemId) => g.classes.find((c) => weaponsOf(c).some((w) => w.id === itemId)) || null;

  const st = {
    cls: classByKey(q.get("class")),
    item: q.get("item") || "",
    oc: q.get("oc") || "",
    sort: q.get("sort") === "top" ? "top" : "new",
    q: (q.get("q") || "").slice(0, 60),
    page: Math.max(1, parseInt(q.get("page") || "1", 10) || 1),
  };
  if (st.item && !itemById(st.item)) st.item = "";
  if (st.oc && !ocs.has(st.oc)) st.oc = "";
  if (st.oc) {
    const o = ocs.get(st.oc);
    st.item = o.weapon.id;
    st.cls = o.cls;
  }

  const results = h("div");
  const tabs = h("div.tabs");
  const search = h("input.input.search", { type: "search", placeholder: "Search titles", maxlength: "60", "aria-label": "Search titles" });
  search.value = st.q;
  const sortNew = button("NEW", { kind: "sec", size: "small", onclick: () => setSort("new") });
  const sortTop = button("TOP", { kind: "sec", size: "small", onclick: () => setSort("top") });

  // A filter button of fixed width (the row never moves) that opens a panel of pictures under it.
  const pickers = [];
  function picker(name, face, body) {
    const btn = h("button.wpick-btn", { type: "button", "aria-haspopup": "true", "aria-expanded": "false" });
    const panel = h("div.wpick-panel", { role: "dialog", "aria-label": name });
    const wrap = h("div.wpick", btn);
    const onOutside = (e) => {
      if (!wrap.contains(e.target) && !(e.target.closest && e.target.closest("#tip"))) close();
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        close();
        btn.focus();
      }
    };
    function open() {
      for (const p of pickers) if (p !== self) p.close();
      mount(panel, body());
      wrap.appendChild(panel);
      btn.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", onOutside, true);
      document.addEventListener("keydown", onKey);
      const on = panel.querySelector(".wpick-tile.on");
      if (on) on.focus({ preventScroll: true });
    }
    function close() {
      panel.remove();
      btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey);
    }
    function draw() {
      const f = face();
      mount(btn, f.pic, h("span.wpick-name", { text: f.text }), h("span.wpick-caret", { "aria-hidden": "true" }));
      btn.setAttribute("aria-label", `${name}: ${f.text}`);
      if (panel.isConnected) mount(panel, body());
    }
    btn.addEventListener("click", () => (panel.isConnected ? close() : open()));
    const self = { wrap, btn, draw, close };
    pickers.push(self);
    return self;
  }

  const none = () => h("span.wpick-none", { "aria-hidden": "true" });
  const tile = (on, label, pic, onclick, extra = "") =>
    h("button.wpick-tile" + extra + (on ? ".on" : ""), { type: "button", "aria-pressed": on ? "true" : "false", onclick },
      h("span.wpick-pic", pic), h("span.wpick-label", { text: label }));
  const classHead = (c) => h("div.wpick-class", classIcon(c), h("span", { text: c.name }));

  const weaponPick = picker("Weapon", () => {
    const it = st.item ? itemById(st.item) : null;
    return { pic: it ? itemPic(it, null, true) : none(), text: it ? it.name : "All weapons" };
  }, () => [
    h("div.wpick-grid.all", tile(!st.item, "All weapons", none(), () => pickItem(""))),
    ...(st.cls ? [st.cls] : g.classes).map((c) => h("div.wpick-group", classHead(c),
      h("div.wpick-grid", weaponsOf(c).map((w) => tile(st.item === w.id, w.name, itemPic(w, null, true), () => pickItem(w.id)))))),
  ]);

  // Overclocks by class, then by weapon; only the chosen class / weapon when one is picked.
  const ocPick = picker("Overclock", () => {
    const o = st.oc ? ocs.get(st.oc).oc : null;
    return { pic: o ? ocIcon(o) : none(), text: o ? o.name : "All overclocks" };
  }, () => {
    const out = [h("div.wpick-grid.all", tile(!st.oc, "All overclocks", none(), () => pickOc("")))];
    for (const c of st.cls ? [st.cls] : g.classes) {
      const weapons = weaponsOf(c).filter((w) => (!st.item || w.id === st.item) && (w.overclocks || []).length);
      if (!weapons.length) continue;
      out.push(h("div.wpick-group", classHead(c), weapons.map((w) => h("div.wpick-sub",
        h("div.wpick-weapon", itemPic(w, null, true), h("span", { text: w.name })),
        h("div.wpick-grid.ocs", w.overclocks.map((o) => {
          const t = tile(st.oc === o.id, o.name, ocIcon(o), () => pickOc(o.id), ".oc-tile");
          setTip(t, () => ocTip(o));
          return t;
        }))))));
    }
    return out;
  });

  function syncUrl() {
    const p = new URLSearchParams();
    if (st.cls) p.set("class", st.cls.key);
    if (st.item) p.set("item", st.item);
    if (st.oc) p.set("oc", st.oc);
    if (st.sort !== "new") p.set("sort", st.sort);
    if (st.q) p.set("q", st.q);
    if (st.page > 1) p.set("page", String(st.page));
    ctx.replaceQuery(p.toString());
  }

  function drawTabs() {
    const all = h("button.tab" + (st.cls ? "" : ".on"), { type: "button", onclick: () => setClass(null) }, "ALL");
    mount(tabs, all, g.classes.map((c) =>
      h("button.tab" + (st.cls === c ? ".on" : ""), { type: "button", onclick: () => setClass(c) },
        classIcon(c), c.name.toUpperCase())));
  }

  function drawFilters() {
    weaponPick.draw();
    ocPick.draw();
  }

  function drawSort() {
    sortNew.classList.toggle("on", st.sort === "new");
    sortTop.classList.toggle("on", st.sort === "top");
  }

  function setClass(c) {
    st.cls = c;
    if (st.item && c && classOf(st.item) !== c) {
      st.item = "";
      st.oc = "";
    }
    st.page = 1;
    drawTabs();
    drawFilters();
    load();
  }

  function setSort(s) {
    st.sort = s;
    st.page = 1;
    drawSort();
    load();
  }

  // A weapon of another class switches the class tab; an overclock of another weapon is dropped.
  function pickItem(id) {
    weaponPick.close();
    weaponPick.btn.focus();
    if (id === st.item) return;
    st.item = id;
    if (st.oc && ocs.get(st.oc).weapon.id !== id) st.oc = "";
    if (id) st.cls = classOf(id) || st.cls;
    st.page = 1;
    drawTabs();
    drawFilters();
    load();
  }

  // An overclock picks its weapon and class too.
  function pickOc(id) {
    ocPick.close();
    ocPick.btn.focus();
    if (id === st.oc) return;
    st.oc = id;
    if (id) {
      const o = ocs.get(id);
      st.item = o.weapon.id;
      st.cls = o.cls;
    }
    st.page = 1;
    drawTabs();
    drawFilters();
    load();
  }

  let timer = 0;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const v = search.value.trim().slice(0, 60);
      if (v === st.q) return;
      st.q = v;
      st.page = 1;
      load();
    }, 350);
  });

  let seq = 0;
  async function load() {
    syncUrl();
    const mine = ++seq;
    mount(results, loadingState());
    const p = new URLSearchParams({ sort: st.sort, page: String(st.page) });
    if (st.cls) p.set("class", st.cls.letter);
    if (st.item) p.set("item", st.item);
    if (st.oc) p.set("oc", st.oc);
    if (st.q) p.set("q", st.q);
    let data;
    try {
      data = await api.get("/api/builds?" + p.toString());
    } catch (e) {
      if (mine !== seq || !ctx.alive()) return;
      mount(results, errorState("COULD NOT LOAD BUILDS", errorText(e), [button("RETRY", { onclick: load })]));
      return;
    }
    if (mine !== seq || !ctx.alive()) return;
    if (!data.builds.length) {
      const filtered = st.cls || st.item || st.oc || st.q;
      mount(results, errorState(st.page > 1 ? "NO MORE BUILDS" : "NO BUILDS FOUND",
        filtered ? "Nothing matches these filters yet. Try another class, weapon or overclock, or make the first one."
          : "No one has shared a build yet. Be the first.",
        [filtered ? button("CLEAR FILTERS", { kind: "sec", onclick: clearAll }) : null,
          button("NEW BUILD", { href: "/new" })]));
      return;
    }
    mount(results, cardGrid(data.builds), pager(data.page, data.hasMore, (n) => {
      st.page = n;
      load();
      window.scrollTo(0, 0);
    }));
  }

  function clearAll() {
    st.cls = null;
    st.item = "";
    st.oc = "";
    st.q = "";
    search.value = "";
    st.page = 1;
    drawTabs();
    drawFilters();
    load();
  }

  drawTabs();
  drawFilters();
  drawSort();
  mount(ctx.app,
    h("div.page-head",
      h("div", h("h1.page-title", { text: "Browse builds" }),
        h("div.page-sub", { text: "Copy a code, press B in game" })),
      button("NEW BUILD", { href: "/new" })),
    tabs,
    h("div.filters", weaponPick.wrap, ocPick.wrap, h("div.sortbox", sortNew, sortTop), search),
    results);
  document.title = "Dwarf Builds";
  await load();
}
