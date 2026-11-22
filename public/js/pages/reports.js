// "/reports" (admins): reported builds, the most recently reported first. Each row: the build card, its reports
// (reason, who, when) and the actions HIDE / UNHIDE and DISMISS (removes the reports, the build stays). DELETE is
// on the build page.

import { h, mount, formatDate } from "../dom.js";
import { api, errorText, loginUrl } from "../api.js";
import { button, loadingState, errorState, feedback, setLabel } from "../ui.js";
import { buildCard, pager } from "../cards.js";

export async function reportsPage(ctx) {
  document.title = "Reports - Dwarf Builds";
  if (!ctx.me) {
    mount(ctx.app, errorState("SIGN IN FIRST", "Reports are for admins.",
      [button("SIGN IN WITH STEAM", { href: loginUrl("/reports"), link: false })]));
    return;
  }
  if (!ctx.me.admin) {
    mount(ctx.app, errorState("ADMINS ONLY", "Only admins can see reports.", [button("BROWSE BUILDS", { href: "/" })]));
    return;
  }
  const page = Math.max(1, parseInt(ctx.query.get("page") || "1", 10) || 1);
  mount(ctx.app, loadingState());
  let data;
  try {
    data = await api.get(`/api/admin/reports?page=${page}`);
  } catch (e) {
    if (!ctx.alive()) return;
    mount(ctx.app, errorState("COULD NOT LOAD REPORTS", errorText(e), [button("RETRY", { onclick: () => reportsPage(ctx) })]));
    return;
  }
  if (!ctx.alive()) return;

  const head = h("div.page-head",
    h("div", h("h1.page-title", { text: "Reports" }),
      h("div.page-sub", { text: "Reported builds, newest report first" })));
  if (!data.builds.length) {
    mount(ctx.app, head, errorState(page > 1 ? "NO MORE REPORTS" : "NO REPORTS", page > 1 ? "" : "Nothing is reported right now.",
      page > 1 ? [button("FIRST PAGE", { kind: "sec", href: "/reports" })] : null));
    return;
  }
  mount(ctx.app, head,
    h("div.rep-list", data.builds.map((b) => reportRow(b))),
    pager(data.page, data.hasMore, (n) => ctx.navigate(`/reports?page=${n}`).then(() => window.scrollTo(0, 0))));
}

function reportRow(b) {
  const msg = feedback("under");
  const row = h("div.rep-row");
  const cardBox = h("div.rep-card", buildCard(b));

  const hideBtn = button(b.hidden ? "UNHIDE" : "HIDE", {
    kind: "sec", size: "small",
    title: "Hide the build from everyone but its author",
    onclick: async () => {
      hideBtn.disabled = true;
      msg.clear();
      try {
        const r = await api.post(`/api/builds/${b.id}/hide`, { hidden: !b.hidden });
        b.hidden = r.hidden;
        setLabel(hideBtn, b.hidden ? "UNHIDE" : "HIDE");
        mount(cardBox, buildCard(b));
        msg.say(b.hidden ? "Hidden." : "Visible again.", true);
      } catch (e) {
        msg.say(errorText(e));
      }
      hideBtn.disabled = false;
    },
  });
  const dismissBtn = button("DISMISS", {
    size: "small",
    title: "Remove these reports; the build stays as it is",
    onclick: async () => {
      dismissBtn.disabled = true;
      msg.clear();
      try {
        await api.del(`/api/admin/reports/${b.id}`);
        // The row stays where it was (nothing below jumps), greyed out, with its answer.
        row.classList.add("done");
        hideBtn.disabled = true;
        setLabel(dismissBtn, "DISMISSED");
        msg.say("Reports dismissed.", true);
      } catch (e) {
        dismissBtn.disabled = false;
        msg.say(errorText(e));
      }
    },
  });

  const count = b.reportCount === 1 ? "1 report" : `${b.reportCount} reports`;
  const more = b.reportCount > b.reports.length ? ` (newest ${b.reports.length} shown)` : "";
  return mount(row,
    cardBox,
    h("div.rep-body",
      h("div.rep-head",
        h("span.label", { text: count + more }),
        b.authorBanned ? h("span.hidden-tag", { text: "AUTHOR BANNED" }) : null),
      h("ul.rep-reasons", b.reports.map((r) =>
        h("li",
          h("div.rep-reason", { text: r.reason }),
          h("div.rep-meta", h("a", { href: `/u/${r.user.steamId}`, "data-link": "", text: r.user.name }), " / ", formatDate(r.createdAt))))),
      h("div.rep-actions", msg, button("OPEN BUILD", { kind: "sec", size: "small", href: `/b/${b.id}` }), hideBtn, dismissBtn)));
}
