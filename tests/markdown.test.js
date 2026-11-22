// Markdown descriptions: parser tree, link sanitising, plain-text strip, DOM render (tiny DOM shim), speed on
// hostile input.

import test from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, stripMarkdown, snippetText, safeUrl } from "../public/js/shared/markdown.js";

const p = (...c) => ({ t: "p", c });
const md = (s) => parseMarkdown(s);

// Every node in the tree, depth first.
function* nodes(list) {
  for (const n of list) {
    yield n;
    if (n && n.c) yield* nodes(n.c);
  }
}
const links = (s) => [...nodes(md(s))].filter((n) => n && n.t === "a");
const ALLOWED = new Set(["p", "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "pre", "hr", "br", "strong", "em", "del", "code", "a"]);

test("paragraphs, line breaks, headings", () => {
  assert.deepEqual(md("one\ntwo\n\nthree"), [p("one", { t: "br" }, "two"), p("three")]);
  assert.deepEqual(md("# A\n## B\n### C\n#### D ##"), [
    { t: "h1", c: ["A"] }, { t: "h2", c: ["B"] }, { t: "h3", c: ["C"] }, { t: "h3", c: ["D"] }]);
  assert.deepEqual(md("#hashtag"), [p("#hashtag")]);
  assert.deepEqual(md("#"), [p("#")]);
  assert.deepEqual(md(""), []);
});

test("inline marks", () => {
  assert.deepEqual(md("**b** __b__ *i* _i_ ~~s~~ `c`"), [p(
    { t: "strong", c: ["b"] }, " ", { t: "strong", c: ["b"] }, " ", { t: "em", c: ["i"] }, " ",
    { t: "em", c: ["i"] }, " ", { t: "del", c: ["s"] }, " ", { t: "code", text: "c" })]);
  assert.deepEqual(md("***x***"), [p({ t: "em", c: [{ t: "strong", c: ["x"] }] })]);
  assert.deepEqual(md("**bold *and it* text**"), [p({ t: "strong", c: ["bold ", { t: "em", c: ["and it"] }, " text"] })]);
  assert.deepEqual(md("snake_case_name and 2*3*4"), [p("snake_case_name and 2", { t: "em", c: ["3"] }, "4")]);
  assert.deepEqual(md("a * b * c, **open"), [p("a * b * c, **open")]);
  assert.deepEqual(md("\\*not\\* \\# \\[x\\]"), [p("*not* # [x]")]);
  assert.deepEqual(md("`` a ` b ``"), [p({ t: "code", text: "a ` b" })]);
  assert.deepEqual(md("`**no**`"), [p({ t: "code", text: "**no**" })]);
  assert.deepEqual(md("~single~ ~~~three~~~"), [p("~single~ ~~~three~~~")]);
});

test("blocks: code, quotes, lists, rules", () => {
  assert.deepEqual(md("```js\nif (a < b) **x**\n\n```"), [{ t: "pre", text: "if (a < b) **x**\n" }]);
  assert.deepEqual(md("~~~\nopen fence"), [{ t: "pre", text: "open fence" }]);
  assert.deepEqual(md("> q1\n> q2\n>> deep"), [{ t: "blockquote", c: [p("q1", { t: "br" }, "q2"), { t: "blockquote", c: [p("deep")] }] }]);
  assert.deepEqual(md("- a\n* b\n  - c\n  - d\n+ e"), [{ t: "ul", c: [
    { t: "li", c: ["a"] },
    { t: "li", c: ["b", { t: "ul", c: [{ t: "li", c: ["c"] }, { t: "li", c: ["d"] }] }] },
    { t: "li", c: ["e"] }] }]);
  assert.deepEqual(md("1. x\n2. **y**\n\n3. z"), [{ t: "ol", c: [
    { t: "li", c: ["x"] }, { t: "li", c: [{ t: "strong", c: ["y"] }] }, { t: "li", c: ["z"] }] }]);
  assert.deepEqual(md("5) five\nmore"), [{ t: "ol", start: 5, c: [{ t: "li", c: ["five", { t: "br" }, "more"] }] }]);
  assert.deepEqual(md("text\n- item\n\nafter"), [p("text"), { t: "ul", c: [{ t: "li", c: ["item"] }] }, p("after")]);
  assert.deepEqual(md("- a\n1. b"), [{ t: "ul", c: [{ t: "li", c: ["a"] }] }, { t: "ol", c: [{ t: "li", c: ["b"] }] }]);
  assert.deepEqual(md("---\n* * *\n___"), [{ t: "hr" }, { t: "hr" }, { t: "hr" }]);
  assert.deepEqual(md("-5 armor, 3.5 seconds"), [p("-5 armor, 3.5 seconds")]);
});

test("links and bare URLs", () => {
  assert.deepEqual(md("[wiki](https://deeprockgalactic.wiki.gg/wiki/Driller)"),
    [p({ t: "a", href: "https://deeprockgalactic.wiki.gg/wiki/Driller", c: ["wiki"] })]);
  assert.deepEqual(md('[t](https://a.com/x_(y) "title")'), [p({ t: "a", href: "https://a.com/x_(y)", c: ["t"] })]);
  assert.deepEqual(md("[**b**](<https://a.com/a b>)"), [p({ t: "a", href: "https://a.com/a%20b", c: [{ t: "strong", c: ["b"] }] })]);
  assert.deepEqual(md("see https://a.com/foo_bar_baz."), [p("see ", { t: "a", href: "https://a.com/foo_bar_baz", c: ["https://a.com/foo_bar_baz"] }, ".")]);
  assert.deepEqual(md("(https://a.com/x)"), [p("(", { t: "a", href: "https://a.com/x", c: ["https://a.com/x"] }, ")")]);
  assert.deepEqual(md("*https://a.com*"), [p({ t: "em", c: [{ t: "a", href: "https://a.com/", c: ["https://a.com"] }] })]);
  assert.deepEqual(md("[https://in.com](https://out.com)"), [p({ t: "a", href: "https://out.com/", c: ["https://in.com"] })]);
  assert.deepEqual(md("[](https://a.com)"), [p({ t: "a", href: "https://a.com/", c: ["https://a.com"] })]);
  assert.deepEqual(md("[no link] [x] (y)"), [p("[no link] [x] (y)")]);
  assert.deepEqual(md("xhttps://a.com"), [p("xhttps://a.com")]);
  assert.deepEqual(md("![img](https://a.com/i.png)"), [p("!", { t: "a", href: "https://a.com/i.png", c: ["img"] })]);
});

test("unsafe link targets lose the link, keep the text", () => {
  const bad = [
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)",
    "java%0ascript:alert(1)", "&#106;avascript:alert(1)", "&#x6A;avascript:alert(1)", "javascript&colon;alert(1)",
    "\\u006aavascript:alert(1)", "%6Aavascript:alert(1)", "data:text/html,<script>alert(1)</script>",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==", "vbscript:msgbox(1)", "VBScript:x", "file:///etc/passwd",
    "//evil.com", "/relative", "#frag", "mailto:a@b.c", "ftp://a.com", "https:evil.com", "https:/evil.com",
    "https://user:pw@evil.com", "https://good.com@evil.com", "http://", "https://", "<javascript:alert(1)>",
  ];
  for (const url of bad) {
    const src = `[click](${url})`;
    const found = links(src);
    assert.equal(found.length, 0, `no link for ${JSON.stringify(url)}: ${JSON.stringify(md(src))}`);
    assert.ok(stripMarkdown(src).includes("click"), url);
  }
  // Bare "javascript:" text is never a link either.
  assert.equal(links("javascript:alert(1) data:text/html,x vbscript:x").length, 0);
  assert.deepEqual(md("[bad](javascript:alert(1)) ok"), [p("bad ok")]);
});

test("safeUrl", () => {
  assert.equal(safeUrl("https://a.com"), "https://a.com/");
  assert.equal(safeUrl("HTTPS://A.COM/X"), "https://a.com/X");
  assert.equal(safeUrl("http://a.com:8080/p?q=1#h"), "http://a.com:8080/p?q=1#h");
  assert.equal(safeUrl("https://bücher.de/"), "https://xn--bcher-kva.de/");
  for (const u of ["", null, "javascript:x", "https://a.com/\"onmouseover=x", "https://a.com/<b>", "https://a.com/\u0000",
    "https://a.com\\@evil.com", "https://a.com/`", "https://" + "a".repeat(3000) + ".com"]) {
    assert.equal(safeUrl(u), null, String(u));
  }
});

test("no raw HTML, only known node types", () => {
  const src = [
    "<script>alert(1)</script>", "<img src=x onerror=alert(1)>", '<a href="javascript:alert(1)">x</a>',
    "<svg/onload=alert(1)>", "[x](https://a.com\" onclick=\"alert(1))", '[x](https://a.com "a" onclick="b")',
    "[[[[a]]]](javascript:x) [a](https://ok.com)](javascript:x) [[b](javascript:y)](https://ok.com)",
    "<iframe src=//evil></iframe> &lt;b&gt; &#60;script&#62;",
  ].join("\n\n");
  const tree = md(src);
  const all = [...nodes(tree)];
  for (const n of all) {
    if (typeof n === "string") continue;
    assert.ok(ALLOWED.has(n.t), `type ${n.t}`);
    for (const k of Object.keys(n)) assert.ok(["t", "c", "text", "href", "start"].includes(k), `key ${k}`);
    if (n.t === "a") assert.match(n.href, /^https?:\/\/[^\s"<>`\\]+$/);
  }
  const text = stripMarkdown(src);
  assert.ok(text.includes("<script>alert(1)</script>"), "HTML stays visible text");
  assert.ok(text.includes("&lt;b&gt;"), "entities are not decoded");
  // The quote ends the target: no link from the brackets, the bare URL before the quote is still one.
  assert.deepEqual(links("[x](https://a.com\" onclick=\"alert(1))").map((a) => a.href), ["https://a.com/"]);
  assert.deepEqual(links("[[b](javascript:y)](https://ok.com)").map((a) => a.href), ["https://ok.com/"]);
});

test("brackets that are not links keep bold and italic working", () => {
  assert.deepEqual(md("**Bullet Hell [Unstable]** is the best"),
    [p({ t: "strong", c: ["Bullet Hell [Unstable]"] }, " is the best")]);
  assert.deepEqual(md("*Use [T1] mods* here"), [p({ t: "em", c: ["Use [T1] mods"] }, " here")]);
  assert.deepEqual(md("**Note [1]: very important**"), [p({ t: "strong", c: ["Note [1]: very important"] })]);
  assert.deepEqual(md("[*a] b*"), [p("[", { t: "em", c: ["a] b"] })]);
  // Many [tags] in one paragraph: the link still takes only its own text.
  const tags = "ABCDEFGHIJKLMNOP".split("").map((c) => `[${c}]`).join(" ");
  assert.deepEqual(md(`Tiers: ${tags} then *italic* and [link](https://e.com)`),
    [p(`Tiers: ${tags} then `, { t: "em", c: ["italic"] }, " and ", { t: "a", href: "https://e.com/", c: ["link"] })]);
  assert.deepEqual(md("[a [b] c](https://e.com)"), [p({ t: "a", href: "https://e.com/", c: ["a [b] c"] })]);
});

test("emphasis edge cases", () => {
  assert.deepEqual(md("*a**b*"), [p({ t: "em", c: ["a**b"] })]);
  assert.deepEqual(md("**a*b**"), [p({ t: "strong", c: ["a*b"] })]);
  assert.deepEqual(md("**a*"), [p("*", { t: "em", c: ["a"] })]);
  assert.deepEqual(md("**a* b*"), [p({ t: "em", c: [{ t: "em", c: ["a"] }, " b"] })]);
  assert.deepEqual(md("***a** b*"), [p({ t: "em", c: [{ t: "strong", c: ["a"] }, " b"] })]);
  assert.deepEqual(md("***a* b**"), [p({ t: "strong", c: [{ t: "em", c: ["a"] }, " b"] })]);
  assert.deepEqual(md("«_текст_» «*текст*»"), [p("«", { t: "em", c: ["текст"] }, "» «", { t: "em", c: ["текст"] }, "»")]);
  assert.deepEqual(md("hard\\\nbreak"), [p("hard", { t: "br" }, "break")]);
});

test("autolinks, list starts, tabs", () => {
  assert.deepEqual(md("see <https://ex.com/a>."), [p("see ", { t: "a", href: "https://ex.com/a", c: ["https://ex.com/a"] }, ".")]);
  assert.deepEqual(md("<javascript:alert(1)> <https://a.com b>"), [p("<javascript:alert(1)> <", { t: "a", href: "https://a.com/", c: ["https://a.com"] }, " b>")]);
  assert.deepEqual(md("The year\n2020. was good"), [p("The year", { t: "br" }, "2020. was good")]);
  assert.deepEqual(md("text\n-"), [p("text", { t: "br" }, "-")]);
  assert.deepEqual(md("text\n1. one"), [p("text"), { t: "ol", c: [{ t: "li", c: ["one"] }] }]);
  assert.deepEqual(md("0. zero"), [{ t: "ol", start: 0, c: [{ t: "li", c: ["zero"] }] }]);
  assert.deepEqual(md("- a\n\t- b"), [{ t: "ul", c: [{ t: "li", c: ["a", { t: "ul", c: [{ t: "li", c: ["b"] }] }] }] }]);
  assert.deepEqual(md("-\titem one\n-\titem two"), [{ t: "ul", c: [{ t: "li", c: ["item one"] }, { t: "li", c: ["item two"] }] }]);
});

test("strip to plain text", () => {
  assert.equal(snippetText("## Mining\nUse drills"), "Mining. Use drills");
  assert.equal(snippetText("**Primary:** Hurricane\n**Secondary:** Breach\n\nDone."), "Primary: Hurricane. Secondary: Breach. Done.");
  assert.equal(stripMarkdown("# Fire\n**Burn** them, see [wiki](https://a.com).\n\n- one\n- `two`\n\n---\n> q"),
    "Fire\nBurn them, see wiki.\none\ntwo\nq");
  assert.equal(stripMarkdown(""), "");
  assert.equal(stripMarkdown("plain text"), "plain text");
});

test("render: elements, text nodes, safe attributes", async () => {
  const restore = installDom();
  try {
    const { renderMarkdown } = await import("../public/js/markdown.js");
    const el = renderMarkdown("# T\n**b** <i>x</i> [l](https://a.com) [j](javascript:alert(1))\n\n3. n\n\n```\n<b>\n```");
    assert.equal(el.tagName, "div");
    assert.equal(el.className, "mdown");
    const tags = [];
    const walk = (e) => {
      for (const c of e.childNodes) {
        if (c.nodeType === 3) continue;
        tags.push(c.tagName);
        if (c.tagName === "a") {
          assert.deepEqual(c.attributes, { href: "https://a.com/", target: "_blank", rel: "noopener noreferrer nofollow ugc" });
        } else if (c.tagName === "ol") assert.deepEqual(c.attributes, { start: "3" });
        else assert.deepEqual(c.attributes, {}, c.tagName);
        walk(c);
      }
    };
    walk(el);
    assert.deepEqual(tags, ["h1", "p", "strong", "a", "ol", "li", "pre", "code"]);
    assert.equal(el.textContent, "Tb <i>x</i> l jn<b>");
    const ol = (src) => renderMarkdown(src).childNodes[0];
    assert.deepEqual(ol("0. a").attributes, { start: "0" });
    assert.equal(ol("999999999. a").attributes.start, "999999999");
    assert.equal(ol("999999999. a").className, "wide");
    assert.equal(ol("1. a").className, "");
  } finally {
    restore();
  }
});

test("hostile input stays fast (4000 chars)", () => {
  const N = 4000;
  const fill = (s) => s.repeat(Math.ceil(N / s.length)).slice(0, N);
  const inputs = [
    "*", "**a", "*a_", "_a*", "~~a", "[", "]", "[](", "[a](", "[a](https://a.com/(", "[a](<", '[a](x "', "`", "`` `",
    "\\", "> ", ">", "- ", "  - ", "1. ", "# ", "```\n", "https://", "https://a.com/(", "https://a.com/)", "https://a@",
    "http://a.com/_*~", "a\n", "\n\n", "*[`", "<script>", "**[*_~`", "[*", "*]", "( ", "- a\n  - b\n", "> - a\n",
  ].map(fill);
  inputs.push(fill("a").slice(0, N - 2) + "**", "**" + fill("a").slice(2), "[" + fill("x") + "](", fill(" ") + "*");
  let worst = 0;
  for (const s of inputs) {
    const t0 = performance.now();
    parseMarkdown(s);
    stripMarkdown(s);
    const ms = performance.now() - t0;
    worst = Math.max(worst, ms);
    assert.ok(ms < 250, `${JSON.stringify(s.slice(0, 12))}... took ${ms.toFixed(1)} ms`);
  }
  // Growth is about linear: 4x the input does not take 16x the time.
  const s1 = fill("*a_[`").slice(0, 1000);
  const s4 = fill("*a_[`");
  const time = (s) => {
    const t0 = performance.now();
    for (let k = 0; k < 20; k++) parseMarkdown(s);
    return performance.now() - t0;
  };
  time(s4);
  assert.ok(time(s4) < time(s1) * 12 + 20, "near-linear");
});

// Security review: every failed "](" rescanned a ~2.3k window, so "[[[...](\(](\(..." cost ~46 ms at 4000
// chars and ~110 ms at 8000. Now the scans share one budget per inline run.
test("many failed link targets stay cheap", () => {
  const shapes = (n) => [
    "[".repeat(15) + "](\\(".repeat(Math.ceil(n / 4)),
    "[](\\(".repeat(Math.ceil(n / 5)),
    "[](((".repeat(Math.ceil(n / 5)),
    '[](x "'.repeat(Math.ceil(n / 6)),
    "[a](<".repeat(Math.ceil(n / 5)),
    "<https://a".repeat(Math.ceil(n / 10)),
  ].map((s) => s.slice(0, n));
  for (const s of shapes(8000)) {
    parseMarkdown(s);
    const t0 = performance.now();
    for (let k = 0; k < 5; k++) {
      parseMarkdown(s);
      stripMarkdown(s);
    }
    const ms = (performance.now() - t0) / 5;
    assert.ok(ms < 25, `${JSON.stringify(s.slice(0, 12))}... took ${ms.toFixed(1)} ms`);
  }
  // The budget does not cost real links: 150 links in one paragraph all work.
  const many = Array.from({ length: 150 }, (_, k) => `[l${k}](https://a.com/${"p".repeat(20)}/${k})`).join(" ");
  assert.equal(links(many).length, 150);
});

// ---- a tiny DOM for dom.js h(): elements, text nodes, attributes
function installDom() {
  class Node {
    constructor(type) {
      this.nodeType = type;
      this.childNodes = [];
    }
    get firstChild() {
      return this.childNodes[0] || null;
    }
    appendChild(c) {
      this.childNodes.push(c);
      return c;
    }
    removeChild(c) {
      this.childNodes.splice(this.childNodes.indexOf(c), 1);
      return c;
    }
    get textContent() {
      return this.nodeType === 3 ? this.data : this.childNodes.map((c) => c.textContent).join("");
    }
    set textContent(v) {
      if (this.nodeType === 3) this.data = String(v);
      else this.childNodes = [new Text(String(v))];
    }
  }
  class Text extends Node {
    constructor(data) {
      super(3);
      this.data = data;
    }
  }
  class Element extends Node {
    constructor(tag) {
      super(1);
      this.tagName = tag;
      this.className = "";
      this.attributes = {};
      this.dataset = {};
      this.style = { setProperty() {} };
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
    }
    addEventListener() {}
  }
  const saved = { document: globalThis.document, Node: globalThis.Node };
  globalThis.Node = Node;
  globalThis.document = { createElement: (t) => new Element(t), createTextNode: (s) => new Text(s) };
  return () => {
    globalThis.document = saved.document;
    globalThis.Node = saved.Node;
  };
}
