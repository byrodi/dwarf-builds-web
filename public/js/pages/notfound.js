// Any unknown path.

import { h, mount } from "../dom.js";
import { button } from "../ui.js";

export function notFoundPage(ctx) {
  document.title = "Not found - Dwarf Builds";
  mount(ctx.app, h("div.state",
    h("div.big-code", { text: "404" }),
    h("h2", { text: "Nothing down here" }),
    h("p", { text: "This tunnel leads nowhere. The page does not exist or was moved." }),
    h("div.actions", button("BROWSE BUILDS", { href: "/" }), button("NEW BUILD", { kind: "sec", href: "/new" }))));
}
