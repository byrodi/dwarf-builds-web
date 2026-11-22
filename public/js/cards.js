// Build cards for lists (browse, user pages) and the pager under them.

import { h, formatDate } from "./dom.js";
import { classByLetter, itemById, ocOf } from "./game.js";
import { classIcon, itemPic, ocIcon, mask, button, setTip, ocTip } from "./ui.js";

function weaponLine(itemId, ocId) {
  const item = itemById(itemId);
  if (!item) return null;
  const oc = ocOf(item, ocId);
  const icon = ocIcon(oc, "sm");
  if (oc) setTip(icon, () => ocTip(oc));
  return h("div.cw",
    h("div.cw-pic", itemPic(item)),
    h("div.cw-text",
      h("div.cw-name", { text: item.name }),
      h("div.cw-oc", oc ? { text: oc.name, style: { color: `var(--${oc.type})` } } : { text: "No overclock" })),
    icon);
}

export function buildCard(c, { showAuthor = true } = {}) {
  const cls = classByLetter(c.class);
  const author = c.author || {};
  return h("a.card", { href: `/b/${c.id}`, style: { "--cls": cls ? `var(--c-${cls.key})` : null } },
    h("div.card-top",
      cls ? classIcon(cls) : null,
      h("div.card-titles",
        h("div.card-title", { text: c.title }),
        h("div.card-by",
          cls ? (cls.name + (showAuthor ? " build by " : " build")) : "",
          showAuthor ? h("b", { text: author.name || "Unknown" }) : null))),
    h("div.card-weps", weaponLine(c.primaryItem, c.primaryOc), weaponLine(c.secondaryItem, c.secondaryOc)),
    h("div.card-foot",
      h("span", c.hidden ? h("span.hidden-tag", { text: "HIDDEN" }) : null, c.hidden ? " " : null, formatDate(c.createdAt)),
      h("span.likes", { title: "Likes" }, mask(null, null, "arrow"), String(c.likes || 0))));
}

export function cardGrid(list, opts) {
  return h("div.cards", list.map((c) => buildCard(c, opts)));
}

export function pager(page, hasMore, go) {
  if (page <= 1 && !hasMore) return null;
  return h("div.pager",
    button("PREV", { kind: "sec", size: "small", disabled: page <= 1, onclick: () => go(page - 1) }),
    h("span.pager-num", { text: `PAGE ${page}` }),
    button("NEXT", { kind: "sec", size: "small", disabled: !hasMore, onclick: () => go(page + 1) }));
}
