// "/u/<steamid>" a user's builds; "/me" your own builds (or a sign-in prompt).

import { h, mount, formatDate } from "../dom.js";
import { api, errorText, loginUrl } from "../api.js";
import { button, loadingState, errorState, avatar } from "../ui.js";
import { cardGrid, pager } from "../cards.js";

export async function mePage(ctx) {
  if (!ctx.me) {
    document.title = "My builds - Dwarf Builds";
    mount(ctx.app, errorState("SIGN IN TO SEE YOUR BUILDS",
      "Sign in with Steam to publish builds and keep them in one place. You sign in on Steam's own page: we never " +
      "see your password or e-mail, only your public Steam ID, name and avatar.",
      [button("SIGN IN WITH STEAM", { href: loginUrl("/me"), link: false }), button("BROWSE", { kind: "sec", href: "/" })]));
    return;
  }
  return userPage(ctx, ctx.me.steamId, true);
}

export async function userPage(ctx, steamIdArg, self = false) {
  const steamId = steamIdArg || ctx.params[0];
  const mine = self || (ctx.me && ctx.me.steamId === steamId);
  const page = Math.max(1, parseInt(ctx.query.get("page") || "1", 10) || 1);
  mount(ctx.app, loadingState());
  let data;
  try {
    data = await api.get(`/api/users/${encodeURIComponent(steamId)}?page=${page}`);
  } catch (e) {
    if (!ctx.alive()) return;
    if (e.status === 404 && self) {
      // Signed in but nothing stored yet: show the empty list.
      data = { user: { steamId, name: ctx.me.name, avatar: ctx.me.avatar, createdAt: 0 }, builds: [], page: 1, hasMore: false };
    } else if (e.status === 404) {
      mount(ctx.app, errorState("DWARF NOT FOUND", "No one with this Steam ID has shared a build here.", [button("BROWSE BUILDS", { href: "/" })]));
      return;
    } else {
      mount(ctx.app, errorState("COULD NOT LOAD BUILDS", errorText(e), [button("RETRY", { onclick: () => userPage(ctx, steamIdArg, self) })]));
      return;
    }
  }
  if (!ctx.alive()) return;
  const u = data.user;
  document.title = (mine ? "My builds" : `${u.name}'s builds`) + " - Dwarf Builds";
  const head = h("div.page-head",
    h("div.uhead", avatar(u, true),
      h("div",
        h("h1.page-title", { text: mine ? "My builds" : u.name }),
        h("div.page-sub", { text: (mine ? u.name + " / " : "") + (u.createdAt ? `Member since ${formatDate(u.createdAt)}` : "New member") }))),
    mine ? button("NEW BUILD", { href: "/new" }) : null);

  let list;
  if (!data.builds.length) {
    list = data.page > 1
      ? errorState("NO MORE BUILDS", "", [button("FIRST PAGE", { kind: "sec", href: location.pathname })])
      : mine
        ? errorState("NO BUILDS YET", "Make your first build in the editor, or press PUBLISH MY BUILD in the mod's BUILD CODE tab.", [button("NEW BUILD", { href: "/new" })])
        : errorState("NO BUILDS YET", `${u.name} has not shared a build yet.`, [button("BROWSE BUILDS", { kind: "sec", href: "/" })]);
  } else {
    list = h("div", cardGrid(data.builds, { showAuthor: false }),
      pager(data.page, data.hasMore, (n) => ctx.navigate(`${location.pathname}?page=${n}`).then(() => window.scrollTo(0, 0))));
  }
  mount(ctx.app, head, list);
}
