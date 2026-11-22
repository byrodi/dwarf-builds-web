// "/new" and "/edit/<id>": the game's loadout screen. Class switcher, gear cards (click: the gear
// modification screen with item tabs, tier choices and overclocks), perk column (click on a slot: the
// perk panel next to it; 3 passive, 2 active, 1 proficiency); title; IMPORT CODE; live code; the
// description under the screen; PUBLISH.
// "/new?code=DB2:..." starts from that code (the mod's PUBLISH MY BUILD opens this).

import { h, mount, textLength } from "../dom.js";
import { api, errorText, loginUrl } from "../api.js";
import { getGame, classByLetter, itemsOf, itemAt, perkById, PERK_TYPES } from "../game.js";
import { parseCode, validateBuild, encodeCode, PREFIX } from "../shared/code.js";
import {
  classIcon, button, copyButton, modal, confirmModal, loadingState, errorState, hideTip, setLabel,
} from "../ui.js";
import { barHeight, loadoutScreen, perkIds } from "../buildview.js";
import { renderMarkdown } from "../markdown.js";

const TITLE_MAX = 80;
const DESC_MAX = 4000;
const DRAFT_KEY = "dwarfbuilds-draft";

function readDraft(path) {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
    if (d && d.path === path && Date.now() - d.ts < 3600 * 1000) return d;
  } catch {
    // no storage
  }
  return null;
}

function writeDraft(d) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, ts: Date.now() }));
  } catch {
    // no storage
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // no storage
  }
}

export async function editorPage(ctx) {
  const editId = ctx.params[0] || null;
  let start = { code: ctx.query.get("code") || "", title: "", description: "" };
  const notes = [];

  if (editId) {
    if (!ctx.me) {
      mount(ctx.app, errorState("SIGN IN TO EDIT", "Sign in with Steam to edit your builds.",
        [button("SIGN IN WITH STEAM", { href: loginUrl(location.pathname), link: false })]));
      return;
    }
    mount(ctx.app, loadingState());
    let b;
    try {
      b = await api.get(`/api/builds/${encodeURIComponent(editId)}`);
    } catch (e) {
      if (!ctx.alive()) return;
      mount(ctx.app, e.status === 404
        ? errorState("BUILD NOT FOUND", "This build does not exist or was deleted.", [button("BROWSE BUILDS", { href: "/" })])
        : errorState("COULD NOT LOAD THE BUILD", errorText(e), [button("RETRY", { onclick: () => editorPage(ctx) })]));
      return;
    }
    if (!ctx.alive()) return;
    if (!b.canEdit) {
      mount(ctx.app, errorState("NOT YOUR BUILD", "You can only edit your own builds. Open it in the editor to make a copy.",
        [button("OPEN IN EDITOR", { href: `/new?code=${encodeURIComponent(b.code)}` }), button("BACK", { kind: "sec", href: `/b/${b.id}` })]));
      return;
    }
    start = { code: b.code, title: b.title, description: b.description || "" };
    if (b.rebuilt) notes.push("The game changed since this build was saved; the code was updated to the current game.");
  }

  const draft = readDraft(location.pathname + location.search);
  if (draft) {
    start = { code: draft.code || start.code, title: draft.title || "", description: draft.description || "", restored: true };
    clearDraft();
  }
  editor(ctx, editId, start, notes);
}


function editor(ctx, editId, start, startNotes) {
  const g = getGame();
  const limits = g.perkSlots || { passive: 3, active: 2, proficiency: 1 };
  const st = {
    cls: null,
    slots: [],
    perks: emptyPerks(), // one entry per slot, 0 = empty
    view: { name: "overview" },
    title: start.title,
    description: start.description,
    busy: false,
  };

  function emptyPerks() {
    const out = {};
    for (const t of PERK_TYPES) out[t] = new Array(limits[t] || 0).fill(0);
    return out;
  }

  // ---- state helpers
  function freshSlots(cls) {
    return g.slots.map((slot) => {
      const it = itemsOf(cls, slot)[0];
      return { item: it ? it.index || 1 : 0, tiers: it ? (it.tiers || []).map(() => 0) : [], oc: 0 };
    });
  }

  function toBuild() {
    return {
      class: st.cls ? st.cls.letter : "",
      slots: st.slots.map((s) => ({ item: s.item, tiers: s.tiers.slice(), oc: s.oc })),
      perks: perkIds(st.perks),
    };
  }

  function current() {
    if (!st.cls) return { ok: false, errors: ["Pick a class"], canonical: null };
    return validateBuild(toBuild(), g);
  }

  function snapshot() {
    return JSON.stringify([st.cls ? encodeCode(toBuild()) : "", st.title.trim(), st.description.trim()]);
  }

  // Loads a code into the state. Returns the list of problems (parts dropped), null when not a code.
  function loadCode(code) {
    const parsed = parseCode(code);
    if (!parsed) return null;
    const v = validateBuild(parsed, g);
    const cls = classByLetter(parsed.class);
    if (!cls || !v.build) return null;
    st.cls = cls;
    st.slots = g.slots.map((slot, i) => {
      const s = v.build.slots[i] || { item: 0, tiers: [], oc: 0 };
      const it = s.item ? itemAt(cls, slot, s.item) : null;
      const tiers = it ? (it.tiers || []).map((_, t) => s.tiers[t] || 0) : [];
      return { item: it ? s.item : 0, tiers, oc: it ? s.oc : 0 };
    });
    st.perks = emptyPerks();
    for (const id of v.build.perks) {
      const p = perkById(id);
      const free = p ? st.perks[p.type].indexOf(0) : -1;
      if (free >= 0) st.perks[p.type][free] = id;
    }
    return v.errors;
  }

  // ---- persistent elements (kept across redraws so typing is not lost)
  const titleInput = h("input.ls-titlein", { type: "text", maxlength: String(TITLE_MAX * 2), placeholder: "Name your build", "aria-label": "Title" });
  const titleCount = h("span.count");
  const descInput = h("textarea.notes-text", { maxlength: String(DESC_MAX * 2), placeholder: "How to play it, what to upgrade first, team notes...", "aria-label": "Description" });
  const descCount = h("span.count");
  titleInput.value = st.title;
  descInput.value = st.description;
  const codeBox = h("div.ls-code");
  const codeMsg = h("div");
  const publishMsg = h("div");
  const topIcon = h("span.ls-clsicon");
  const screen = h("div.ls-host");
  const copyBtn = copyButton(() => current().canonical || "", { kind: "sec", size: "small" });
  const importBtn = button("IMPORT CODE", { kind: "sec", size: "small", onclick: () => openImport() });
  let publishBtn = null;

  // ---- first load
  const notes0 = startNotes.slice();
  if (start.code) {
    const errs = loadCode(start.code);
    if (errs === null) notes0.push("The code in the link is not a valid build code. Start a new build below.");
    else if (errs.length) notes0.push("Some parts of the code do not match the current game and were dropped: " + errs.slice(0, 6).join("; ") + ".");
  }
  const EMPTY = JSON.stringify(["", "", ""]);
  let saved = EMPTY;
  ctx.setGuard(() => snapshot() !== saved && !st.busy);

  // ---- import
  function openImport() {
    const input = h("input.input.code-input", { type: "text", placeholder: PREFIX + ":...", spellcheck: "false", autocomplete: "off", "aria-label": "Build code" });
    const p = modal({
      title: "Import code",
      body: h("div.field", h("p", { text: "Paste a build code (from the mod or from another build)." }), input),
      buttons: [{ label: "CANCEL", kind: "sec", value: null }, { label: "IMPORT", value: "go" }],
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      // Stop here: the same Enter must not also confirm the "replace the build?" dialog that opens next.
      e.preventDefault();
      e.stopPropagation();
      const btns = document.querySelectorAll(".modal .actions .btn");
      if (btns.length) btns[btns.length - 1].click();
    });
    input.focus();
    p.then((v) => {
      if (v === "go") doImport(input.value.trim());
    });
  }

  async function doImport(code) {
    // Results go to the floating notice: no layout shift under the top bar.
    if (!code) {
      ctx.notice("Paste a build code first.");
      return;
    }
    if (!parseCode(code)) {
      ctx.notice(`This is not a valid build code (it starts with ${PREFIX}:).`);
      return;
    }
    if (st.cls && !(await confirmModal("REPLACE THE BUILD?", "The imported code replaces the class, gear and perks you picked. Title and description stay.", "IMPORT"))) return;
    const errs = loadCode(code);
    if (errs && errs.length) ctx.notice("Imported. Some parts do not match the current game and were dropped: " + errs.slice(0, 6).join("; ") + ".");
    else ctx.notice("Imported.", true);
    st.view = { name: "overview" };
    draw();
  }

  titleInput.addEventListener("input", () => {
    st.title = titleInput.value;
    drawSide();
  });
  descInput.addEventListener("input", () => {
    st.description = descInput.value;
    drawSide();
  });

  // ---- class
  function pickClass(cls) {
    st.cls = cls;
    st.slots = freshSlots(cls);
    st.view = { name: "overview" };
    draw();
  }

  async function classStep(dir) {
    const list = g.classes;
    const next = list[(list.indexOf(st.cls) + dir + list.length) % list.length];
    const untouched = JSON.stringify(st.slots) === JSON.stringify(freshSlots(st.cls));
    if (!untouched && !(await confirmModal("SWITCH CLASS?", `Weapons, gear and upgrades are reset for the ${next.name}. Perks stay.`, "SWITCH"))) return;
    pickClass(next);
  }

  function classChooser() {
    return h("div.cls-chooser",
      h("div.md-name", h("h2", { text: "Choose a class" }), h("div.md-cat", { text: "You can switch it later" })),
      h("div.classes", g.classes.map((c) =>
        h("button.cls-card", { type: "button", style: { "--cls": `var(--c-${c.key})` }, onclick: () => pickClass(c) },
          c.portrait ? h("img", { src: "/" + c.portrait, alt: "", loading: "lazy" }) : null,
          h("div.cls-row", classIcon(c), h("span.cls-name", { text: c.name }))))));
  }

  // ---- changes from the screen
  const slotIndex = (slot) => g.slots.indexOf(slot);
  const change = {
    item(slot, index) {
      const it = itemAt(st.cls, slot, index);
      if (!it) return;
      st.slots[slotIndex(slot)] = { item: index, tiers: (it.tiers || []).map(() => 0), oc: 0 };
      draw();
    },
    tier(slot, t, n) {
      st.slots[slotIndex(slot)].tiers[t] = n;
      draw();
    },
    oc(slot, n) {
      st.slots[slotIndex(slot)].oc = n;
      draw();
    },
    // Puts perk `id` (0 = none) into slot i; a perk already in another slot swaps places with it.
    perk(type, i, id) {
      const slots = st.perks[type];
      const at = id ? slots.indexOf(id) : -1;
      if (at >= 0 && at !== i) slots[at] = slots[i];
      slots[i] = id || 0;
      st.view = { name: "overview" };
      draw();
    },
    classStep,
  };

  function go(view) {
    st.view = view;
    draw();
    const top = screen.getBoundingClientRect().top;
    if (top < barHeight() || top > window.innerHeight * 0.5) window.scrollTo(0, Math.max(0, top + window.pageYOffset - barHeight()));
  }

  // ---- code, counts, publish state
  function drawSide() {
    const v = current();
    if (v.canonical && v.ok) {
      codeBox.textContent = v.canonical;
      codeBox.classList.remove("bad");
      mount(codeMsg);
    } else {
      codeBox.textContent = st.cls ? "Pick at least one item" : "Pick a class first";
      codeBox.classList.add("bad");
      mount(codeMsg, st.cls && v.errors && v.errors.length ? h("div.msg.err", { text: v.errors.slice(0, 4).join("; ") }) : null);
    }
    copyBtn.disabled = !(v.ok && v.canonical);
    const tl = textLength(st.title.trim());
    const dl = textLength(st.description.trim());
    titleCount.textContent = `${tl} / ${TITLE_MAX}`;
    titleCount.classList.toggle("over", tl > TITLE_MAX);
    descCount.textContent = `${dl} / ${DESC_MAX}`;
    descCount.classList.toggle("over", dl > DESC_MAX);
    if (publishBtn) publishBtn.disabled = st.busy || !(v.ok && v.canonical) || !tl || tl > TITLE_MAX || dl > DESC_MAX;
  }

  function actionBox() {
    if (!ctx.me) {
      publishBtn = null;
      return h("div.ls-actions",
        h("span.ls-hint.wide", { text: "Sign in with Steam to publish; your build is kept. You sign in on Steam's own " +
          "page: we never see your password or e-mail and get no access to your account, only your public Steam ID, " +
          "name and avatar." }),
        button("SIGN IN TO PUBLISH", { onclick: signInToPublish }));
    }
    publishBtn = button(editId ? "SAVE CHANGES" : "PUBLISH", { onclick: publish });
    return h("div.ls-actions",
      editId ? button("CANCEL", { kind: "sec", href: `/b/${editId}` }) : null,
      publishBtn);
  }

  function signInToPublish() {
    const v = current();
    const code = v.ok ? v.canonical : "";
    const path = "/new" + (code ? `?code=${encodeURIComponent(code)}` : "");
    writeDraft({ path, code, title: st.title, description: st.description });
    st.busy = true; // no leave prompt: the draft is kept
    location.href = loginUrl(path);
  }

  async function publish() {
    const v = current();
    const title = st.title.trim();
    if (!v.ok || !v.canonical) {
      ctx.notice("The build is not complete: " + (v.errors || []).join("; "));
      return;
    }
    if (!title) {
      ctx.notice("Give your build a title.");
      titleInput.focus();
      return;
    }
    st.busy = true;
    drawSide();
    mount(publishMsg);
    const body = { title, description: st.description.trim(), code: v.canonical };
    try {
      const r = editId ? await api.put(`/api/builds/${editId}`, body) : await api.post("/api/builds", body);
      saved = snapshot();
      ctx.setGuard(null);
      clearDraft();
      ctx.notice(editId ? "Changes saved." : "Build published. Share the link or copy the code.", true);
      ctx.navigate(`/b/${r.id}`, { replace: !!editId });
      window.scrollTo(0, 0);
    } catch (e) {
      st.busy = false;
      if (e.status === 401) {
        mount(publishMsg, h("div.msg.err", h("span", { text: "Your session ended. " }), h("button.link-btn", { type: "button", text: "SIGN IN AGAIN", onclick: signInToPublish })));
      } else {
        ctx.notice(errorText(e));
      }
      drawSide();
    }
  }

  // ---- page
  const action = actionBox();
  // PREVIEW: the rendered Markdown in place of the textarea, at least as tall as it was (CSS lets it grow
  // to 70vh); the button then reads EDIT.
  const descPreview = h("div.notes-preview", { hidden: true, tabindex: "0", "aria-label": "Description preview" });
  let previewing = false;
  const previewBtn = button("PREVIEW", { kind: "sec", size: "small", onclick: () => togglePreview() });
  function togglePreview() {
    previewing = !previewing;
    if (previewing) {
      const height = descInput.offsetHeight;
      if (height) descPreview.style.minHeight = `${height}px`;
      const text = st.description.trim();
      mount(descPreview, text ? renderMarkdown(text) : h("div.desc.empty", { text: "Nothing to preview yet." }));
      descPreview.scrollTop = 0;
    }
    descInput.hidden = previewing;
    descPreview.hidden = !previewing;
    setLabel(previewBtn, previewing ? "EDIT" : "PREVIEW");
    previewBtn.classList.toggle("on", previewing);
    if (!previewing) descInput.focus();
  }
  const descBox = h("div.ls-desc",
    h("div.ls-deschead",
      h("div.ls-deshead-l", h("span.ls-desctitle", { text: "Description" }), h("span.ls-deshint", { text: "Markdown supported" })),
      h("div.ls-deshead-r", descCount, previewBtn)),
    descInput, descPreview);
  function draw() {
    hideTip();
    mount(topIcon, st.cls ? classIcon(st.cls) : null);
    if (!st.cls) {
      mount(screen, classChooser());
      descBox.hidden = true;
    } else {
      descBox.hidden = false;
      mount(screen, loadoutScreen({ cls: st.cls, slots: st.slots, perks: st.perks }, {
        edit: true, view: st.view, go, action, change,
      }));
    }
    drawSide();
  }

  document.title = (editId ? "Edit build" : "New build") + " - Dwarf Builds";
  mount(ctx.app,
    h("div.ls-top",
      topIcon,
      h("div.ls-titlebox", h("div.ls-titlehead", h("span.label", { text: editId ? "Edit build" : "New build" }), titleCount), titleInput),
      h("div.ls-codebox", h("span.label", { text: "Build code" }), codeBox),
      h("div.ls-topbtns", copyBtn, importBtn)),
    h("div.ls-msgs",
      notes0.length ? h("div.msg", notes0.map((n) => h("div", { text: n }))) : null,
      codeMsg, publishMsg),
    screen,
    descBox);
  draw();
  // Only the user's own changes count as unsaved work; a restored draft counts too.
  saved = start.restored ? EMPTY : snapshot();
}
