// Entry: loads game data and the session, draws the top bar and routes pages on the client.
// Routes: /  /b/<id>  /new  /edit/<id>  /u/<steamid>  /me  (anything else: 404 view).
// MY BUILDS is your own /u/<steamid> (the link others get); /me sends you there, or asks you to sign in.

import { h, mount } from "./dom.js";
import { api, loginUrl } from "./api.js";
import { loadGame } from "./game.js";
import { initTips, hideTip, closeModal, avatar, loadingState, errorState, button, confirmModal } from "./ui.js";
import { browsePage } from "./pages/browse.js";
import { buildPage } from "./pages/build.js";
import { editorPage } from "./pages/editor.js";
import { userPage, mePage } from "./pages/user.js";
import { notFoundPage } from "./pages/notfound.js";

const app = document.getElementById("app");
const session = { me: undefined };
let renderToken = 0;
let guard = null; // () => true when the page has unsaved changes
let currentUrl = location.pathname + location.search;

const ROUTES = [
  { re: /^\/$/, page: browsePage, nav: "browse" },
  { re: /^\/b\/([0-9A-Za-z]{1,32})\/?$/, page: buildPage, nav: "" },
  { re: /^\/new\/?$/, page: editorPage, nav: "new" },
  { re: /^\/edit\/([0-9A-Za-z]{1,32})\/?$/, page: editorPage, nav: "" },
  { re: /^\/u\/([0-9]{1,20})\/?$/, page: userPage, nav: "" },
  { re: /^\/me\/?$/, page: mePage, nav: "me" },
];

// ---------------------------------------------------------------- session and top bar

export function getMe() {
  return session.me || null;
}

async function loadMe() {
  try {
    session.me = await api.get("/api/me");
  } catch {
    session.me = null;
  }
  drawAccount();
}

function drawAccount() {
  const box = document.getElementById("account");
  const me = session.me;
  const mine = document.querySelector('[data-nav="me"]');
  if (mine) mine.setAttribute("href", me ? `/u/${me.steamId}` : "/me");
  if (me === undefined) return mount(box);
  if (!me) {
    const b = button("SIGN IN", {
      kind: "sec", size: "small", href: loginUrl(location.pathname + location.search), link: false,
      title: "Sign in through Steam",
    });
    b.querySelector(".lbl").appendChild(h("span.wide-text", { text: " WITH STEAM" }));
    return mount(box, b);
  }
  const menu = h("div.menu", { hidden: true, role: "menu" },
    h("a", { href: `/u/${me.steamId}`, "data-link": "", text: "MY BUILDS" }),
    h("a", { href: "/new", "data-link": "", text: "NEW BUILD" }),
    h("button", { type: "button", text: "SIGN OUT", onclick: signOut }));
  const btn = h("button.user-btn", {
    type: "button", "aria-haspopup": "true",
    onclick: (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    },
  }, avatar(me), h("span.user-name", { text: me.name }), h("span.caret"));
  mount(box, btn, menu);
}

document.addEventListener("click", () => {
  const m = document.querySelector("#account .menu");
  if (m) m.hidden = true;
});

async function signOut() {
  if (guard && guard() && !(await confirmModal("LEAVE THIS PAGE?", "You have unsaved changes. Sign out anyway?", "SIGN OUT"))) return;
  try {
    await api.post("/api/auth/logout", {});
  } catch {
    // the cookie may already be gone
  }
  guard = null;
  session.me = null;
  drawAccount();
  route();
}

export function setGuard(fn) {
  guard = fn;
}

function setNav(name) {
  for (const a of document.querySelectorAll("[data-nav]")) a.classList.toggle("on", a.dataset.nav === name);
}

// The top bar tab of a route: your own /u/<steamid> is MY BUILDS.
function navOf(hit, params) {
  if (!hit) return "";
  if (hit.page === userPage && session.me && params[0] === session.me.steamId) return "me";
  return hit.nav;
}

// ---------------------------------------------------------------- notices

let noticeAt = 0;

export function notice(text, ok = false) {
  const bar = document.getElementById("notice");
  noticeAt = Date.now();
  if (!text) {
    bar.hidden = true;
    return;
  }
  mount(bar, h("span", { text }), h("button.link-btn.dim", { type: "button", text: "DISMISS", onclick: () => { bar.hidden = true; } }));
  bar.classList.toggle("ok", ok);
  bar.hidden = false;
  const at = noticeAt;
  setTimeout(() => {
    if (noticeAt === at) bar.hidden = true;
  }, ok ? 5000 : 9000);
}

// ---------------------------------------------------------------- router

export async function navigate(url, { replace = false } = {}) {
  if (guard && guard()) {
    const leave = await confirmModal("LEAVE THIS PAGE?", "You have unsaved changes. They will be lost.", "LEAVE", "danger");
    if (!leave) return false;
  }
  guard = null;
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  route();
  return true;
}

// Changes the query of the current page without a new render (filters).
export function replaceQuery(search) {
  const url = location.pathname + (search ? "?" + search : "");
  history.replaceState(null, "", url);
  currentUrl = url;
}

function isCurrent(token) {
  return token === renderToken;
}

async function route() {
  const token = ++renderToken;
  hideTip();
  closeModal();
  // A notice set just before this navigation (e.g. "Build published") stays; older ones go.
  if (Date.now() - noticeAt > 1500) document.getElementById("notice").hidden = true;
  currentUrl = location.pathname + location.search;
  const path = location.pathname;
  const query = new URLSearchParams(location.search);
  let hit = null;
  let params = [];
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) {
      hit = r;
      params = m.slice(1);
      break;
    }
  }
  setNav(navOf(hit, params));
  drawAccount();
  mount(app, loadingState());
  try {
    await loadGame();
  } catch {
    if (!isCurrent(token)) return;
    mount(app, errorState("GAME DATA IS MISSING", "The site could not load its game data. Try again in a moment.",
      [button("RETRY", { onclick: () => route() })]));
    return;
  }
  if (!isCurrent(token)) return;
  if (session.me === undefined) {
    await loadMe();
    if (!isCurrent(token)) return;
    setNav(navOf(hit, params));
  }
  const ctx = {
    app, params, query, me: session.me || null, token,
    alive: () => isCurrent(token),
    navigate, setGuard, notice, replaceQuery,
  };
  try {
    await (hit ? hit.page(ctx) : notFoundPage(ctx));
  } catch (e) {
    console.error(e);
    if (!isCurrent(token)) return;
    mount(app, errorState("SOMETHING BROKE", "This page could not be drawn. Try again.", [button("RETRY", { onclick: () => route() })]));
  }
  if (isCurrent(token)) app.focus({ preventScroll: true });
}

// Same-origin links go through the router; /api/ links (sign-in) are real page loads.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest ? e.target.closest("a[href]") : null;
  if (!a || a.target || a.hasAttribute("download")) return;
  const href = a.getAttribute("href");
  if (!href || !href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/")) return;
  e.preventDefault();
  if (href === location.pathname + location.search) return;
  navigate(href).then((moved) => {
    if (moved) window.scrollTo(0, 0);
  });
});

window.addEventListener("popstate", async () => {
  if (guard && guard()) {
    const back = location.pathname + location.search;
    history.pushState(null, "", currentUrl);
    const leave = await confirmModal("LEAVE THIS PAGE?", "You have unsaved changes. They will be lost.", "LEAVE", "danger");
    if (!leave) return;
    guard = null;
    history.replaceState(null, "", back);
  }
  route();
});

window.addEventListener("beforeunload", (e) => {
  if (guard && guard()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ---------------------------------------------------------------- start

initTips();
loadGame().then((g) => {
  const v = document.getElementById("data-version");
  if (v && g.version) v.textContent = `Game data ${g.version}`;
}).catch(() => {});

const q = new URLSearchParams(location.search);
if (q.get("signin") === "failed") {
  notice("Steam sign-in failed. Please try again.");
  q.delete("signin");
  const s = q.toString();
  history.replaceState(null, "", location.pathname + (s ? "?" + s : ""));
}
route();
