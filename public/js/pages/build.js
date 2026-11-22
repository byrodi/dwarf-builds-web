// "/b/<id>" one build: the game's loadout screen read-only (cards open the gear modification screen),
// title, author, date, description, COPY CODE, how to use it in game, like and report; edit / delete for
// the owner, hide for admins.

import { h, mount, formatDate, textLength } from "../dom.js";
import { api, errorText, loginUrl } from "../api.js";
import { classByLetter } from "../game.js";
import { parseCode } from "../shared/code.js";
import { barHeight, loadoutScreen, perksByType } from "../buildview.js";
import { renderMarkdown } from "../markdown.js";
import {
  classIcon, button, copyButton, mask, modal, confirmModal, loadingState, errorState, avatar, setLabel, hideTip,
  feedback, flash,
} from "../ui.js";

const REASON_MAX = 500;
const MOD_PAGE = "https://mod.io/g/drg/m/dwarf-builds";

export async function buildPage(ctx) {
  const id = ctx.params[0];
  mount(ctx.app, loadingState());
  let b;
  try {
    b = await api.get(`/api/builds/${encodeURIComponent(id)}`);
  } catch (e) {
    if (!ctx.alive()) return;
    if (e.status === 404) {
      mount(ctx.app, errorState("BUILD NOT FOUND", "This build does not exist, was deleted or is hidden.",
        [button("BROWSE BUILDS", { href: "/" })]));
    } else {
      mount(ctx.app, errorState("COULD NOT LOAD THE BUILD", errorText(e), [button("RETRY", { onclick: () => buildPage(ctx) })]));
    }
    return;
  }
  if (!ctx.alive()) return;
  draw(ctx, b);
}

function draw(ctx, b) {
  const me = ctx.me;
  const cls = classByLetter(b.class);
  const parsed = parseCode(b.code);
  document.title = `${b.title} - Dwarf Builds`;

  // Top bar: class, title, author, dates, likes, actions.
  const author = b.author || {};
  const likesText = (n) => `${n} ${n === 1 ? "like" : "likes"}`;
  const likeCount = h("span", { text: likesText(b.likes || 0) });
  const meta = h("div.bmeta",
    h("span", avatar(author), h("a", { href: `/u/${author.steamId}`, text: author.name || "Unknown" })),
    h("span", { text: formatDate(b.createdAt) + (b.updatedAt && b.updatedAt - b.createdAt > 60000 ? `, edited ${formatDate(b.updatedAt)}` : "") }),
    h("span.likes", mask(null, null, "arrow"), likeCount));

  // A refused action (like, hide, delete) is answered in a line under these buttons.
  const actMsg = feedback("under");
  const actions = h("div.ls-topbtns", actMsg);
  const likeBtn = button(b.liked ? "LIKED" : "LIKE", { kind: "sec", size: "small", on: b.liked });
  likeBtn.classList.add("like-btn");
  likeBtn.querySelector("span").insertBefore(mask(null, null, "arrow"), likeBtn.querySelector(".lbl"));
  likeBtn.addEventListener("click", async () => {
    if (!me) {
      location.href = loginUrl(location.pathname);
      return;
    }
    likeBtn.disabled = true;
    actMsg.clear();
    try {
      const r = await api.post(`/api/builds/${b.id}/like`, {});
      b.liked = r.liked;
      b.likes = r.likes;
      likeCount.textContent = likesText(r.likes);
      setLabel(likeBtn, r.liked ? "LIKED" : "LIKE");
      likeBtn.classList.toggle("on", r.liked);
    } catch (e) {
      actMsg.say(errorText(e));
    }
    likeBtn.disabled = false;
  });
  // Your own build cannot be liked (the server refuses it too): no button, the count stays in the line above.
  if (!(me && author.steamId === me.steamId)) actions.appendChild(likeBtn);
  actions.appendChild(button("OPEN IN EDITOR", { kind: "sec", size: "small", href: `/new?code=${encodeURIComponent(b.code)}`, title: "Start a new build from this one" }));
  if (b.canEdit) actions.appendChild(button("EDIT", { size: "small", href: `/edit/${b.id}` }));
  if (b.canHide) {
    actions.appendChild(button(b.hidden ? "UNHIDE" : "HIDE", {
      kind: "sec", size: "small",
      onclick: async () => {
        try {
          await api.post(`/api/builds/${b.id}/hide`, { hidden: !b.hidden });
          b.hidden = !b.hidden;
          draw(ctx, b);
        } catch (e) {
          actMsg.say(errorText(e));
        }
      },
    }));
  }
  if (b.canDelete) {
    actions.appendChild(button("DELETE", {
      kind: "danger", size: "small",
      onclick: async () => {
        const ok = await confirmModal("DELETE BUILD?", `"${b.title}" will be deleted for good. This cannot be undone.`, "DELETE", "danger");
        if (!ok) return;
        try {
          await api.del(`/api/builds/${b.id}`);
          ctx.navigate(me ? `/u/${me.steamId}` : "/", { replace: true, note: { text: "Build deleted.", ok: true } });
        } catch (e) {
          actMsg.say(errorText(e));
        }
      },
    }));
  }
  if (!b.canEdit) {
    const reportBtn = h("button.link-btn.dim", {
      type: "button", text: "REPORT",
      onclick: () => (me ? report(b, reportBtn) : (location.href = loginUrl(location.pathname))),
    });
    actions.appendChild(reportBtn);
  }

  const top = h("div.ls-top.bt",
    h("span.ls-clsicon", cls ? classIcon(cls) : null),
    h("div.ls-titlebox",
      h("div.ls-titlehead", h("span.label", { text: `${cls ? cls.name : ""} build` })),
      h("h1.btitle", { text: b.title }),
      meta),
    actions);

  const msgs = h("div.ls-msgs");
  // The result of the action that led here ("Build published"), shown once.
  if (ctx.note) msgs.appendChild(h("div.msg.flash-msg" + (ctx.note.ok ? ".ok" : ".err"), { role: "status", text: ctx.note.text }));
  ctx.note = null;
  if (b.hidden) msgs.appendChild(h("div.msg.err", { text: "This build is hidden. Only you and admins can see it." }));
  if (b.rebuilt) {
    msgs.appendChild(h("div.msg",
      h("div", { text: "The game changed since this build was saved. The code below was updated to the current game." }),
      b.missing && b.missing.length ? h("ul", b.missing.slice(0, 8).map((m) => h("li", { text: `Dropped: ${m}` }))) : null));
  }

  // Under the screen: description, then the code and how to use it in game.
  const desc = String(b.description || "").trim();
  const info = h("div.bp-info",
    h("div.ls-desc.bp-desc",
      h("div.ls-deschead", h("span.ls-desctitle", { text: "Description" })),
      desc ? renderMarkdown(desc) : h("div.desc.empty", { text: "No description." })),
    h("div.ls-desc.bp-use",
      h("div.ls-deschead", h("span.ls-desctitle", { text: "Build code" })),
      h("div.codebox", { text: b.code }),
      h("div.howto",
        h("div.notes-sub", { text: "Use it in game" }),
        h("ol",
          h("li", h("b", { text: "COPY CODE" }), "."),
          h("li", "In game press ", h("span.kbd", { text: "B" }), " (or your key from Mod Hub) and open the ", h("b", { text: "BUILD CODE" }), " tab."),
          h("li", "Press ", h("b", { text: "PASTE FROM CLIPBOARD" }), ", then ", h("b", { text: "TAKE BUILD" }), ".")),
        h("div.label", "Needs the ", h("a.modlink", { href: MOD_PAGE, target: "_blank", rel: "noopener", text: "Dwarf Builds mod" }),
          " from mod.io"))));
  const action = h("div.ls-actions", copyButton(() => b.code, {}));

  const screen = h("div.ls-host");
  const st = { view: { name: "overview" } };
  const model = parsed && cls ? { cls, slots: parsed.slots, perks: perksByType(parsed.perks) } : null;
  function redraw() {
    hideTip();
    if (!model) {
      mount(screen, h("div.msg.err", { text: "This build code cannot be read." }));
      return;
    }
    mount(screen, loadoutScreen(model, {
      edit: false, view: st.view, action,
      go: (v) => {
        st.view = v;
        redraw();
        const t = screen.getBoundingClientRect().top;
        if (t < barHeight() || t > window.innerHeight * 0.5) window.scrollTo(0, Math.max(0, t + window.pageYOffset - barHeight()));
      },
    }));
  }
  mount(ctx.app, top, msgs, screen, info);
  redraw();
}

// The dialog stays open until the report is sent: a refusal is answered under the field. After that the
// REPORT link itself says it was sent.
async function report(b, reportBtn) {
  const ta = h("textarea.textarea", { maxlength: String(REASON_MAX * 2), placeholder: "What is wrong with this build?", style: { "min-height": "110px" } });
  const count = h("span.count", { text: `0 / ${REASON_MAX}` });
  ta.addEventListener("input", () => {
    const n = textLength(ta.value);
    count.textContent = `${n} / ${REASON_MAX}`;
    count.classList.toggle("over", n > REASON_MAX);
  });
  const msg = feedback("line");
  const v = await modal({
    title: "REPORT BUILD",
    body: h("div.field", h("div.field-head", h("span.label", { text: "Reason" }), count), ta, msg),
    buttons: [{ label: "CANCEL", kind: "sec", value: null }, { label: "SEND REPORT", value: "send" }],
    check: async () => {
      const reason = ta.value.trim();
      const problem = !reason ? "Write a reason to report a build."
        : textLength(reason) > REASON_MAX ? `The reason is longer than ${REASON_MAX} characters.` : "";
      if (problem) {
        msg.say(problem);
        flash(ta);
        ta.focus();
        return false;
      }
      try {
        await api.post(`/api/builds/${b.id}/report`, { reason });
        return true;
      } catch (e) {
        msg.say(errorText(e));
        return false;
      }
    },
  });
  if (v !== "send") return;
  reportBtn.textContent = "REPORT SENT";
  reportBtn.disabled = true;
}
