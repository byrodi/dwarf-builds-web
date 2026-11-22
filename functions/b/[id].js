// GET /b/:id -> index.html with Open Graph tags (Discord/Steam link previews).
// Replaces the literal <!--og--> in index.html. On any problem it serves the page unchanged.

import { loadGameData } from "../_lib/gamedata.js";
import { isBuildId, displayName } from "../_lib/builds.js";
import { classByLetter, itemBySlot, parseCode } from "../../public/js/shared/code.js";
import { snippetText } from "../../public/js/shared/markdown.js";

const MARK = "<!--og-->";

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cut(s, n) {
  const chars = [...String(s || "").replace(/\s+/g, " ").trim()];
  return chars.length > n ? chars.slice(0, n - 1).join("") + "…" : chars.join("");
}

export function ogTags({ title, description, url, image }) {
  const tags = [
    ["property", "og:site_name", "Dwarf Builds"],
    ["property", "og:type", "website"],
    ["property", "og:title", title],
    ["property", "og:description", description],
    ["property", "og:url", url],
    ["name", "twitter:card", "summary"],
    ["name", "theme-color", "#FF9C00"],
  ];
  if (image) tags.push(["property", "og:image", image]);
  return tags.map(([k, n, v]) => `<meta ${k}="${n}" content="${escapeHtml(v)}">`).join("\n");
}

async function indexPage(env, url) {
  let res = await env.ASSETS.fetch(new URL("/index.html", url).toString(), { redirect: "manual" });
  if (res.status >= 300 && res.status < 400) res = await env.ASSETS.fetch(new URL("/", url).toString());
  return res;
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  let page;
  try {
    page = await indexPage(env, request.url);
  } catch {
    return context.next();
  }
  try {
    if (!page.ok || !isBuildId(params.id)) return page;
    const html = await page.clone().text();
    if (!html.includes(MARK)) return page;
    const row = await env.DB.prepare(
      `SELECT b.id, b.class, b.title, b.description, b.code, b.hidden, u.name AS author_name, u.banned, b.user_id
       FROM builds b JOIN users u ON u.steam_id = b.user_id WHERE b.id = ?`
    )
      .bind(params.id)
      .first();
    if (!row || row.hidden || row.banned) return page;

    const url = new URL(request.url);
    const game = await loadGameData(env, request.url);
    let summary = "";
    let image = null;
    if (game) {
      const cls = classByLetter(game, row.class);
      const b = parseCode(row.code);
      const names = b
        ? [0, 1].map((i) => (b.slots[i].item ? itemBySlot(game, row.class, i, b.slots[i].item) : null)).filter(Boolean).map((it) => it.name)
        : [];
      summary = [cls ? cls.name : "", names.join(" / ")].filter(Boolean).join(" - ");
      if (cls && cls.portrait) image = new URL(cls.portrait.replace(/^\/+/, "/"), `${url.origin}/`).toString();
    }
    const by = `by ${displayName(row.author_name, row.user_id)}`;
    // The description is Markdown: plain text only in the preview. Only its start can show, so only that is parsed.
    const plain = snippetText([...String(row.description || "")].slice(0, 600).join(""));
    const description = cut([summary, by, plain].filter(Boolean).join(". "), 200);
    const tags = ogTags({ title: cut(row.title, 80), description, url: `${url.origin}/b/${row.id}`, image });
    const headers = new Headers(page.headers);
    headers.delete("Content-Length");
    headers.delete("ETag");
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Cache-Control", "public, max-age=300");
    // A function, not a string: user text with "$'" or "$`" must not pull page parts in.
    return new Response(html.replace(MARK, () => tags), { status: 200, headers });
  } catch (e) {
    console.error("og error", e && e.message);
    return page;
  }
}
