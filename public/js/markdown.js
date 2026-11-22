// Build descriptions as Markdown: the tree from shared/markdown.js turned into elements. Only known tags,
// text through text nodes, hrefs only from safeUrl (http/https). Links open in a new tab.

import { h } from "./dom.js";
import { parseMarkdown } from "./shared/markdown.js";

const TAGS = new Set(["p", "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "strong", "em", "del"]);
const REL = "noopener noreferrer nofollow ugc";

function toNode(n) {
  if (typeof n === "string") return document.createTextNode(n);
  switch (n.t) {
    case "br":
      return h("br");
    case "hr":
      return h("hr");
    case "pre":
      return h("pre", h("code", { text: n.text }));
    case "code":
      return h("code", { text: n.text });
    case "a":
      return h("a", { href: n.href, target: "_blank", rel: REL }, (n.c || []).map(toNode));
    case "ol": {
      // Numbers with 3+ digits do not fit the left padding: such lists put the marker inside.
      const start = Number.isInteger(n.start) && n.start >= 0 ? n.start : 1;
      const wide = String(start + n.c.length - 1).length >= 3;
      return h(wide ? "ol.wide" : "ol", { start: start !== 1 ? String(start) : null }, n.c.map(toNode));
    }
    default:
      return TAGS.has(n.t) ? h(n.t, (n.c || []).map(toNode)) : h("span", (n.c || []).map(toNode));
  }
}

// <div class="mdown"> with the rendered description.
export function renderMarkdown(src) {
  return h("div.mdown", parseMarkdown(src).map(toNode));
}
