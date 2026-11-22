// Small Markdown subset for build descriptions. No DOM here: parseMarkdown() returns a plain tree,
// js/markdown.js turns it into elements (text nodes only, never HTML), stripMarkdown() into plain text
// (meta tags). Used by the browser and by the Functions.
//
// Blocks: paragraphs (a single newline is a line break), # ## ### headings, ``` / ~~~ fenced code,
// > quotes, - * + and 1. lists (one nested level), --- *** ___ rules.
// Inline: **bold** __bold__, *italic* _italic_, ~~strike~~, `code`, [text](url), <url> and bare
// http(s):// URLs, backslash escapes. No images, no raw HTML (it stays text).
// Links: only http: and https: (see safeUrl); anything else keeps its text and loses the link.
//
// Tree node: a string (text) or { t, c: [children] } with t in p h1 h2 h3 ul ol li blockquote strong em
// del a (plus href; ol may have start), or { t: "pre" | "code", text }, or { t: "br" | "hr" }.
//
// Hostile input stays cheap: one pass per line and per inline run, no backtracking regex over user text,
// inline nesting and quote depth are capped, link targets are scanned at most URL_MAX chars each and
// DEST_BUDGET chars per inline run in all.

export const URL_MAX = 2048;
const INLINE_DEPTH = 16;
const QUOTE_DEPTH = 3;
const PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const EMPH = { "*": { 1: "em", 2: "strong" }, _: { 1: "em", 2: "strong" }, "~": { 2: "del" } };

// The href to use for a link target, or null. Only absolute http(s) URLs without user:password, no
// spaces or control chars, no quotes or angle brackets; returns the parsed, normalised form.
export function safeUrl(raw) {
  const s = String(raw == null ? "" : raw);
  if (!s || s.length > URL_MAX) return null;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f || c === 0x22 || c === 0x3c || c === 0x3e || c === 0x5c || c === 0x60) return null;
  }
  if (!/^https?:\/\//i.test(s)) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname || u.username || u.password) return null;
  return u.href;
}

export function parseMarkdown(src) {
  const lines = String(src == null ? "" : src).replace(/\r\n?/g, "\n").split("\n");
  return blocks(lines, 0);
}

// One line for meta tags: the lines of stripMarkdown() joined as sentences ("Mining. Use drills").
export function snippetText(src) {
  let out = "";
  for (const line of stripMarkdown(src).split("\n")) {
    if (!line) continue;
    out = !out ? line : out + (/[.!?:;,…·—-]$/.test(out) ? " " : ". ") + line;
  }
  return out;
}

// Plain text for snippets: no marks, links become their text, blocks are separated by newlines.
export function stripMarkdown(src) {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (typeof n === "string") out.push(n);
      else if (n.t === "br") out.push("\n");
      else if (n.t === "pre" || n.t === "code") out.push(n.text);
      else if (n.c) {
        const block = BLOCK.has(n.t);
        if (block) out.push("\n");
        walk(n.c);
        if (block) out.push("\n");
      }
    }
  };
  walk(parseMarkdown(src));
  return out.join("").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}
const BLOCK = new Set(["p", "h1", "h2", "h3", "ul", "ol", "li", "blockquote"]);

// ---------------------------------------------------------------- blocks

function indentOf(line) {
  let w = 0;
  let i = 0;
  for (; i < line.length; i++) {
    if (line[i] === " ") w++;
    else if (line[i] === "\t") w += 4 - (w % 4);
    else break;
  }
  return { width: w, chars: i };
}

function runLength(s, i, ch) {
  let j = i;
  while (j < s.length && s[j] === ch) j++;
  return j - i;
}

function fenceOf(s) {
  const ch = s[0];
  if (ch !== "`" && ch !== "~") return null;
  const n = runLength(s, 0, ch);
  if (n < 3) return null;
  if (ch === "`" && s.indexOf("`", n) >= 0) return null; // ``` with more backticks is inline code
  return { ch, n };
}

function isRule(s) {
  const ch = s[0];
  if (ch !== "-" && ch !== "*" && ch !== "_") return false;
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ch) count++;
    else if (s[i] !== " " && s[i] !== "\t") return false;
  }
  return count >= 3;
}

function headingOf(s) {
  if (s[0] !== "#") return null;
  const n = runLength(s, 0, "#");
  if (n > 6 || (n < s.length && s[n] !== " " && s[n] !== "\t")) return null;
  let text = s.slice(n).trim();
  // Closing hashes: "## Title ##".
  let e = text.length;
  while (e > 0 && text[e - 1] === "#") e--;
  if (e === 0) text = "";
  else if (e < text.length && (text[e - 1] === " " || text[e - 1] === "\t")) text = text.slice(0, e).trim();
  if (!text) return null; // a lone "#" stays text
  return { level: Math.min(n, 3), text };
}

// "- x", "* x", "+ x", "1. x", "1) x" -> { ordered, num, rest }.
function markerOf(s) {
  const c = s[0];
  if (c === "-" || c === "*" || c === "+") {
    if (s.length > 1 && s[1] !== " " && s[1] !== "\t") return null;
    return { ordered: false, num: 0, rest: s.slice(1).trim() };
  }
  let d = 0;
  while (d < s.length && d < 10 && s[d] >= "0" && s[d] <= "9") d++;
  if (d === 0 || d > 9 || (s[d] !== "." && s[d] !== ")")) return null;
  if (s.length > d + 1 && s[d + 1] !== " " && s[d + 1] !== "\t") return null;
  return { ordered: true, num: Number(s.slice(0, d)), rest: s.slice(d + 1).trim() };
}

function startsBlock(s, depth) {
  return !!(fenceOf(s) || headingOf(s) || isRule(s) || (s[0] === ">" && depth < QUOTE_DEPTH));
}

function blocks(lines, depth) {
  const out = [];
  let para = null;
  const flush = () => {
    if (para) out.push({ t: "p", c: inline(para.join("\n")) });
    para = null;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const ind = indentOf(line);
    const s = line.slice(ind.chars).trimEnd();
    if (!s) {
      flush();
      i++;
      continue;
    }
    const fence = fenceOf(s);
    if (fence) {
      flush();
      const body = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        const t = l.slice(indentOf(l).chars).trimEnd();
        if (t[0] === fence.ch && runLength(t, 0, fence.ch) >= fence.n && runLength(t, 0, fence.ch) === t.length) {
          i++;
          break;
        }
        // Drop up to the fence's own indent.
        let k = 0;
        while (k < ind.chars && k < l.length && (l[k] === " " || l[k] === "\t")) k++;
        body.push(l.slice(k));
        i++;
      }
      out.push({ t: "pre", text: body.join("\n") });
      continue;
    }
    const head = headingOf(s);
    if (head) {
      flush();
      out.push({ t: "h" + head.level, c: inline(head.text) });
      i++;
      continue;
    }
    if (isRule(s)) {
      flush();
      out.push({ t: "hr" });
      i++;
      continue;
    }
    if (s[0] === ">" && depth < QUOTE_DEPTH) {
      flush();
      const inner = [];
      while (i < lines.length) {
        const l = lines[i];
        const t = l.slice(indentOf(l).chars);
        if (t[0] !== ">") break;
        inner.push(t[1] === " " ? t.slice(2) : t.slice(1));
        i++;
      }
      out.push({ t: "blockquote", c: blocks(inner, depth + 1) });
      continue;
    }
    const m = markerOf(s);
    // Inside a paragraph only "- x" or "1. x" starts a list: "The year\n2020. was good" stays text.
    if (m && !(para && (!m.rest || (m.ordered && m.num !== 1)))) {
      flush();
      const r = list(lines, i, depth, ind.width, -1);
      out.push(r.node);
      i = r.next;
      continue;
    }
    if (!para) para = [];
    para.push(s);
    i++;
  }
  flush();
  return out;
}

// A list starting at lines[i]. `base` = indent of its first marker; `floor` = for a nested list, the
// smallest indent that still belongs to it (-1 at the top level). Deeper markers join the nested level.
function list(lines, i, depth, base, floor) {
  const first = markerOf(lines[i].slice(indentOf(lines[i]).chars).trimEnd());
  const node = { t: first.ordered ? "ol" : "ul", c: [] };
  if (first.ordered && first.num !== 1) node.start = first.num;
  const items = [];
  let cur = null;
  const belongs = (w) => (floor < 0 ? w < base + 2 : w >= floor);
  while (i < lines.length) {
    const line = lines[i];
    const ind = indentOf(line);
    const s = line.slice(ind.chars).trimEnd();
    if (!s) {
      // A blank line ends the list unless the next text line is another item of it (or of its sublist).
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length) break;
      const nind = indentOf(lines[j]);
      const nm = markerOf(lines[j].slice(nind.chars).trimEnd());
      if (!nm || (floor >= 0 && nind.width < floor)) break;
      if (belongs(nind.width) && nm.ordered !== first.ordered && floor < 0) break;
      i = j;
      continue;
    }
    const m = startsBlock(s, depth) ? null : markerOf(s);
    if (m) {
      if (floor >= 0 && ind.width < floor) break; // back to the parent list
      if (floor < 0 && ind.width >= base + 2 && cur) {
        const r = list(lines, i, depth, ind.width, base + 2);
        cur.sub.push(r.node);
        i = r.next;
        continue;
      }
      if (m.ordered !== first.ordered) {
        if (floor < 0) break;
      }
      cur = { lines: [m.rest], sub: [] };
      items.push(cur);
      i++;
      continue;
    }
    if (startsBlock(s, depth) || !cur || cur.sub.length) break;
    cur.lines.push(s); // continuation line of the item
    i++;
  }
  for (const it of items) node.c.push({ t: "li", c: [...inline(it.lines.join("\n")), ...it.sub] });
  return { node, next: i };
}

// ---------------------------------------------------------------- inline

function isSpace(c) {
  return c === undefined || c === " " || c === "\t" || c === "\n" || c === " " || c === "\r" || c === "\f" || c === "\v";
}
// ASCII punctuation: what a backslash can escape.
function isPunct(c) {
  return c !== undefined && PUNCT.includes(c);
}
// Any Unicode punctuation or symbol (« » — …): for the rules of where * and _ can open or close.
const UPUNCT = /[\p{P}\p{S}]/u;
function isFlankPunct(c) {
  return c !== undefined && (PUNCT.includes(c) || UPUNCT.test(c));
}
function isWordChar(c) {
  return c !== undefined && /[0-9A-Za-zÀ-￿]/.test(c);
}

function pushNode(arr, x) {
  if (typeof x === "string") {
    if (!x) return;
    if (typeof arr[arr.length - 1] === "string") arr[arr.length - 1] += x;
    else arr.push(x);
  } else arr.push(x);
}

// Moves frames above stack[fi] back into it as plain text (their opening marks become literal).
function unwindInto(stack, fi) {
  const f = stack[fi];
  for (let j = fi + 1; j < stack.length; j++) {
    pushNode(f.c, stack[j].lit);
    for (const x of stack[j].c) pushNode(f.c, x);
  }
  stack.length = fi + 1;
}

// Link text must not hold links (bare URLs in it): keep their text.
function unlink(nodes, depth = 0) {
  const out = [];
  for (const n of nodes) {
    if (typeof n === "string") pushNode(out, n);
    else if (n.t === "a") for (const x of unlink(n.c, depth + 1)) pushNode(out, x);
    else if (n.c && depth < 4 * INLINE_DEPTH) out.push({ ...n, c: unlink(n.c, depth + 1) }); // a frame can nest 2 nodes
    else out.push(n);
  }
  return out;
}

// Next run of exactly k backticks at or after `from`, or -1.
function findTicks(s, from, k) {
  let j = s.indexOf("`", from);
  while (j >= 0) {
    const r = runLength(s, j, "`");
    if (r === k) return j;
    j = s.indexOf("`", j + r);
  }
  return -1;
}

// Link target after "](": url [title] ")". Returns { url, end } or null. Scans a bounded window and
// takes what it scanned from meter.left (one budget per inline run), so many failed "](" stay cheap.
function linkDest(s, j0, meter) {
  const lim = Math.min(s.length, j0 + URL_MAX + 256, j0 + meter.left);
  let j = j0;
  const fail = () => {
    meter.left -= Math.min(j, lim) - j0;
    return null;
  };
  while (j < lim && (s[j] === " " || s[j] === "\t")) j++;
  let url;
  if (s[j] === "<") {
    const st = j + 1;
    j = st;
    while (j < lim && s[j] !== ">" && s[j] !== "\n" && s[j] !== "<") j++;
    if (j >= lim || s[j] !== ">") return fail();
    url = s.slice(st, j).replace(/ /g, "%20");
    j++;
  } else {
    const st = j;
    let parens = 0;
    while (j < lim) {
      const c = s[j];
      if (c === "\\" && j + 1 < lim && isPunct(s[j + 1])) {
        j += 2;
        continue;
      }
      if (c === "(") parens++;
      else if (c === ")") {
        if (parens === 0) break;
        parens--;
      } else if (isSpace(c)) break;
      j++;
    }
    url = s.slice(st, j).replace(/\\([!-/:-@[-`{-~])/g, "$1");
  }
  while (j < lim && (s[j] === " " || s[j] === "\t")) j++;
  if (j < lim && (s[j] === '"' || s[j] === "'")) {
    const q = s[j];
    j++;
    while (j < lim && s[j] !== q) j++;
    if (j >= lim) return fail();
    j++;
    while (j < lim && (s[j] === " " || s[j] === "\t")) j++;
  }
  if (j >= lim || s[j] !== ")") return fail();
  meter.left -= j + 1 - j0;
  return { url, end: j + 1 };
}
const DEST_BUDGET = 32768;

// Bare URL at s[i] ("http://" or "https://"): its end index, or -1.
function bareUrlEnd(s, i) {
  const head = s.slice(i, i + 8).toLowerCase();
  if (!head.startsWith("https://") && !head.startsWith("http://")) return -1;
  if (i > 0 && isWordChar(s[i - 1])) return -1;
  const lim = Math.min(s.length, i + URL_MAX);
  let j = i;
  while (j < lim && !isSpace(s[j]) && !"<>\"`[]".includes(s[j])) j++;
  // Trailing punctuation belongs to the sentence; ")" only when unbalanced.
  let open = 0;
  let close = 0;
  for (let k = i; k < j; k++) {
    if (s[k] === "(") open++;
    else if (s[k] === ")") close++;
  }
  for (;;) {
    const c = s[j - 1];
    if (".,:;!?'*_~".includes(c)) j--;
    else if (c === ")" && close > open) {
      j--;
      close--;
    } else if (c === "(") {
      j--;
      open--;
    } else break;
  }
  return j > i + 8 || (j > i + 7 && head.startsWith("http://")) ? j : -1;
}

export function inline(s) {
  const root = { ch: "", count: 0, lit: "", c: [] };
  const stack = [root];
  let buf = "";
  const top = () => stack[stack.length - 1];
  const flush = () => {
    if (buf) pushNode(top().c, buf);
    buf = "";
  };
  const failedTicks = new Set();
  const meter = { left: DEST_BUDGET };
  const n = s.length;
  let i = 0;
  while (i < n) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "\n") {
      i++; // "\" at the end of a line: a hard break, which a newline already is
      continue;
    }
    if (ch === "\\" && i + 1 < n && isPunct(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      flush();
      top().c.push({ t: "br" });
      i++;
      continue;
    }
    if (ch === "`") {
      const k = runLength(s, i, "`");
      if (!failedTicks.has(k)) {
        const end = findTicks(s, i + k, k);
        if (end >= 0) {
          flush();
          let code = s.slice(i + k, end).replace(/\n/g, " ");
          if (code.length > 2 && code[0] === " " && code[code.length - 1] === " " && code.trim()) code = code.slice(1, -1);
          top().c.push({ t: "code", text: code });
          i = end + k;
          continue;
        }
        failedTicks.add(k); // no later run of this length either
      }
      buf += s.slice(i, i + k);
      i += k;
      continue;
    }
    if (ch === "*" || ch === "_" || ch === "~") {
      const k = runLength(s, i, ch);
      const before = i > 0 ? s[i - 1] : undefined;
      const after = s[i + k];
      const lf = !isSpace(after) && (!isFlankPunct(after) || isSpace(before) || isFlankPunct(before));
      const rf = !isSpace(before) && (!isFlankPunct(before) || isSpace(after) || isFlankPunct(after));
      const usable = ch === "~" ? k === 2 : k <= 3;
      const canOpen = usable && (ch === "_" ? lf && (!rf || isFlankPunct(before)) : lf);
      const canClose = usable && (ch === "_" ? rf && (!lf || isFlankPunct(after)) : rf);
      const both = canOpen && canClose;
      // CommonMark "rule of 3": in *a**b* the ** neither closes the * nor is closed by it.
      const fits = (f) => ch === "~" || !(f.both || both) || (f.run + k) % 3 !== 0 || (f.run % 3 === 0 && k % 3 === 0);
      let left = usable ? k : 0;
      if (canClose) {
        while (left > 0) {
          let fi = -1;
          for (let j = stack.length - 1; j > 0; j--) {
            if (stack[j].ch === "[") break; // emphasis does not close across an open link
            if (stack[j].ch === ch && fits(stack[j])) {
              fi = j;
              break;
            }
          }
          if (fi < 0) break;
          flush();
          unwindInto(stack, fi);
          const f = top();
          const use = f.count >= 2 && left >= 2 ? 2 : 1;
          const inner = f.c.length ? { t: EMPH[ch][use], c: f.c } : ch.repeat(use * 2);
          if (use === f.count) {
            stack.pop();
            pushNode(top().c, inner);
          } else {
            // "***a** b*", "**a*": the inner marks close, the rest stays open around them.
            f.count -= use;
            f.lit = ch.repeat(f.count);
            f.c = [inner];
          }
          left -= use;
        }
      }
      if (left > 0 && canOpen && stack.length < INLINE_DEPTH) {
        flush();
        stack.push({ ch, count: left, lit: ch.repeat(left), c: [], run: k, both });
        left = 0;
      }
      buf += ch.repeat(left + (usable ? 0 : k));
      i += k;
      continue;
    }
    if (ch === "[") {
      if (stack.length < INLINE_DEPTH) {
        flush();
        stack.push({ ch: "[", count: 1, lit: "[", c: [] });
      } else buf += "[";
      i++;
      continue;
    }
    if (ch === "]") {
      let fi = -1;
      for (let j = stack.length - 1; j > 0; j--) {
        if (stack[j].ch === "[") {
          fi = j;
          break;
        }
      }
      const d = fi > 0 && s[i + 1] === "(" ? linkDest(s, i + 2, meter) : null;
      if (d) {
        flush();
        unwindInto(stack, fi);
        const f = stack.pop();
        const href = safeUrl(d.url);
        const label = unlink(f.c);
        if (href) top().c.push({ t: "a", href, c: label.length ? label : [d.url] });
        else for (const x of label) pushNode(top().c, x);
        i = d.end;
        continue;
      }
      if (fi > 0) {
        // "[T5]" with no "(url)": the "[" is text again; marks opened inside it stay open, so
        // "**Bullet Hell [Unstable]**" is still bold.
        flush();
        const f = stack[fi];
        stack.splice(fi, 1);
        pushNode(stack[fi - 1].c, "[");
        for (const x of f.c) pushNode(stack[fi - 1].c, x);
      }
      buf += "]";
      i++;
      continue;
    }
    if (ch === "<" && (s[i + 1] === "h" || s[i + 1] === "H")) {
      // <https://a.com>: a link without the angle brackets. The scan stops at the next "<".
      const lim = Math.min(n, i + 2 + URL_MAX);
      let j = i + 1;
      while (j < lim && s[j] !== ">" && s[j] !== "<" && !isSpace(s[j])) j++;
      const href = j < lim && s[j] === ">" ? safeUrl(s.slice(i + 1, j)) : null;
      if (href) {
        flush();
        top().c.push({ t: "a", href, c: [s.slice(i + 1, j)] });
        i = j + 1;
        continue;
      }
    }
    if (ch === "h" || ch === "H") {
      const end = bareUrlEnd(s, i);
      if (end > 0) {
        const text = s.slice(i, end);
        const href = safeUrl(text);
        if (href) {
          flush();
          top().c.push({ t: "a", href, c: [text] });
        } else buf += text;
        i = end;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  unwindInto(stack, 0);
  return root.c;
}
