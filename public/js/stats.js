// Gear stats panel of the GEAR MODIFICATIONS screen, computed like the game (see Docs/dwarfbuilds-site.md,
// section 3, "stats"). ES module without dependencies: works in the browser and in node.
//
//   computeStats(item, chosen, oc) -> { rows: [{ label, text, delta, better }], lines: [{ text, tone }] } | null
//
// item   a game.json item; null result when it has no "stats" (the screen then shows the description)
// chosen one entry per tier: the chosen option object of that tier, or null
// oc     the chosen overclock object, or null
//
// A row value is (base + sum of added amounts) * product of percentage amounts of the equipped upgrades with
// the row's key, in 32-bit floats like the game. delta is the change caused by the overclock, formatted like
// the game's preview ("-1.3", "+20%"), or null. better: true/false when the delta is good/bad, else null.
// Rows with "expr" / "dexpr" compute their text from values (expression trees, see evalExpr); "when" holds
// value conditions; an "if" entry "a|b" holds when any of the keys is set.

const f32 = Math.fround;

// An upgrade without a required sub item ("@...") applies to every sub item of its type; "key@" (required
// class: the item itself) only to the row key without a sub item.
function keyMatches(effectKey, rowKey) {
  return effectKey === rowKey || effectKey === rowKey.split("@")[0] || effectKey === rowKey + "@";
}

function effectsOf(list) {
  const out = [];
  for (const o of list) if (o && Array.isArray(o.effects)) out.push(...o.effects);
  return out;
}

// cond: "key" (an equipped effect has it), "!cond" (not) or "a|b" (any of them). now / was: the shown build
// and the one compared with (the equipped one while hovering). A prefix picks the build: "=a" the shown one
// only, "^a" the equipped one only; without one, either.
function condHolds(cond, now, was) {
  if (cond.startsWith("!")) return !condHolds(cond.slice(1), now, was);
  const pre = cond[0] === "=" || cond[0] === "^" ? cond[0] : "";
  const lists = pre === "=" ? [now] : pre === "^" ? [was] : [now, was];
  return cond.slice(pre.length).split("|").some((k) => lists.some((l) => l.some((e) => keyMatches(e[0], k))));
}

function isActive(cond, effects) {
  return condHolds(cond, effects, effects);
}

function valueOf(row, effects) {
  let add = 0;
  let mult = 1;
  for (const e of effects) {
    if (e.length < 3 || !keyMatches(e[0], row.key)) continue;
    if (e[2]) mult = f32(mult * e[1]);
    else add = f32(add + e[1]);
  }
  return f32(f32(row.base + add) * mult);
}

// ---------------------------------------------------------------- number text (FText::AsNumber, en)

export function formatNumber(value, maxFrac = 0, sign = false, grouping = true) {
  if (!Number.isFinite(value)) value = 0;
  const neg = value < 0;
  const a = Math.abs(value);
  let int = Math.trunc(a);
  const scale = 10 ** maxFrac;
  // half to even on the last shown digit, like FastDecimalFormat (fraction scaled separately)
  const scaled = (a - int) * scale;
  let frac = Math.floor(scaled);
  const rest = scaled - frac;
  if (rest > 0.5 || (rest === 0.5 && (int * scale + frac) % 2 === 1)) frac += 1;
  if (frac >= scale) {
    int += 1;
    frac -= scale;
  }
  const fracText = maxFrac ? String(frac).padStart(maxFrac, "0").replace(/0+$/, "") : "";
  let intText = String(int);
  if (grouping) intText = intText.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const zero = int === 0 && frac === 0;
  const text = intText + (fracText ? "." + fracText : "");
  return (neg && !zero ? "-" : sign ? "+" : "") + text;
}

const div = (a, b) => (b === 0 ? 0 : f32(a / b)); // Kismet Divide_FloatFloat gives 0 for b = 0
const roundInt = (x) => Math.floor(x + 0.5);
const roundDec1 = (x) => f32(roundInt(f32(x * 10)) / 10);

// FormatPercentage of BPL_UpgradeHelpers: [value text, delta text]
function percentage(base, up, old, cur, fmt) {
  const v = fmt === 3 || fmt === 12 ? Math.min(1000, Math.max(0, f32(cur - 1))) : cur;
  return [
    formatNumber(f32(v * 100), 0, fmt !== 8) + "%",
    formatNumber(f32(f32(up - old) * 100), 0, true) + "%",
  ];
}

// FormatValues of BPL_UpgradeHelpers: [value text, delta text] for stat format fmt.
// cur is the shown value, up / old the values with and without the overclock, active: an upgrade sets it.
export function formatStat(fmt, base, cur, up, old, active = false) {
  switch (fmt) {
    case 0:
      return [formatNumber(cur, 0), formatNumber(roundInt(up) - roundInt(old), 0, true)];
    case 1:
      return [formatNumber(cur, 1), formatNumber(f32(roundDec1(up) - roundDec1(old)), 1, true)];
    case 2:
    case 3:
    case 8:
      return percentage(base, up, old, cur, fmt);
    case 4:
      return [formatNumber(f32(cur / 100), 1), formatNumber(f32(f32(up / 100) - f32(old / 100)), 1, true)];
    case 5:
    case 6:
      return ["", ""];
    case 7:
      return [active ? "+1" : "0", ""];
    case 9:
    case 10: {
      const d = div(1, base);
      return percentage(1, f32(up * d), f32(old * d), f32(d * cur), fmt === 9 ? 2 : 8);
    }
    case 11: {
      const d = div(1, base);
      const change = f32(div(1, f32(f32(d * up) - f32(d * old))) * -1);
      return [formatNumber(div(1, cur), 0), formatNumber(change, 0, true, false)];
    }
    case 12:
    case 13: {
      const sel = fmt === 13 ? -1 : 1;
      const d = div(1, f32(base * sel));
      return percentage(0, f32(up * d), f32(old * d), f32(f32(d * cur) - sel), 0);
    }
    default:
      return ["", ""];
  }
}

// ---------------------------------------------------------------- expressions
// Rows computed from values ("expr", "dexpr") and value conditions ("when"), as built by the exporter
// (Tools/gamedata/stats.py EXPR_OPS): nested arrays, first item the op, leaves numbers and strings.

// Leading number of a text like C atof / atoi: "+20%" -> 20, "1,200" -> 1, else 0.
function leadingNumber(s, integer) {
  const m = String(s).match(integer ? /^\s*([+-]?\d+)/ : /^\s*([+-]?(\d+(\.\d*)?|\.\d+))/);
  return m ? Number(m[1]) : 0;
}

// now / before: effect lists of the shown build and the one compared with; status(key): PreviewStatus.
function evalExpr(t, now, before, status) {
  if (!Array.isArray(t)) return t;
  const [op] = t;
  const val = (key, base, list) => (key ? valueOf({ key, base }, list) : base);
  if (op === "val") return val(t[1], t[2], now);
  if (op === "old") return val(t[1], t[2], before);
  if (op === "text") {
    const [, key, base, fmt, part] = t;
    const n = val(key, base, now);
    const b = val(key, base, before);
    return formatStat(fmt, base, n, n, b, key ? isActive(key, now) : false)[part];
  }
  if (op === "status") return status(t[1]);
  if (op === "pct") return percentProduct(t[1], t[2] ? before : now);
  const a = t.slice(1).map((x) => evalExpr(x, now, before, status));
  switch (op) {
    case "fstr": return sanitizeFloat(a[0]);
    case "num": return f32(leadingNumber(a[0], false));
    case "inum": return leadingNumber(a[0], true);
    case "+": return f32(a[0] + a[1]);
    case "-": return f32(a[0] - a[1]);
    case "*": return f32(a[0] * a[1]);
    case "/": return a[1] === 0 ? 0 : f32(a[0] / a[1]);
    case "round": return roundInt(a[0]);
    case "floor": return Math.floor(a[0]);
    case "trunc": return Math.trunc(a[0]);
    case "itext": return formatNumber(Math.trunc(a[0]), 0, a[1], a[2]);
    case "ftext": return formatFixed(a[0], a[3], a[4], a[1], a[2]);
    case "cat": return a.join("");
    case "worse": return a.some((x) => x < 0) ? -1 : a.some((x) => x > 0) ? 1 : 0;
    case "<": return a[0] < a[1];
    case "<=": return a[0] <= a[1];
    case ">": return a[0] > a[1];
    case ">=": return a[0] >= a[1];
    case "==": return a[0] === a[1];
    case "!=": return a[0] !== a[1];
    case "and": return Boolean(a[0]) && Boolean(a[1]);
    case "or": return Boolean(a[0]) || Boolean(a[1]);
    case "not": return !a[0];
    default: return "";
  }
}

// product of the percentage amounts of a key (UpgradedPercentageValue)
function percentProduct(key, effects) {
  let mult = 1;
  for (const e of effects) if (e.length >= 3 && e[2] && keyMatches(e[0], key)) mult = f32(mult * e[1]);
  return mult;
}

// FString::SanitizeFloat (Kismet Conv_FloatToString): "%f" without trailing zeros, at least one decimal
function sanitizeFloat(v) {
  const s = Number(v).toFixed(6).replace(/0+$/, "");
  return s.endsWith(".") ? s + "0" : s;
}

// FText::AsNumber with a minimum number of fraction digits (padded with zeros)
function formatFixed(value, minFrac, maxFrac, sign, grouping) {
  let text = formatNumber(value, maxFrac, sign, grouping);
  if (minFrac > 0) {
    const dot = text.indexOf(".");
    const have = dot < 0 ? 0 : text.length - dot - 1;
    if (have < minFrac) text += (dot < 0 ? "." : "") + "0".repeat(minFrac - have);
  }
  return text;
}

// [key, base] of the upgrade values an expression reads ("pct": only the product, base 1)
function exprKeys(t, out = []) {
  if (Array.isArray(t)) {
    if ((t[0] === "val" || t[0] === "old" || t[0] === "text") && t[1]) out.push([t[1], t[2]]);
    else if (t[0] === "pct" && t[1]) out.push([t[1], 1]);
    for (const x of t.slice(1)) exprKeys(x, out);
  }
  return out;
}

// PreviewStatus of a key: 0 Normal, 1 Upgraded, 2 Previewed (the shown build changes it), 3 PreviewReduced
function statusOf(key, now, before) {
  const a = isActive(key, now);
  const b = isActive(key, before);
  if (!a && !b) return 0;
  if (!a) return 3;
  const mine = (list) => JSON.stringify(list.filter((e) => keyMatches(e[0], key)));
  return b && mine(now) === mine(before) ? 1 : 2;
}

// better: from "bdelta" (the change of the value whose PreviewStatus the row keeps) and its direction
function exprRow(r, now, before, showDelta) {
  const status = (k) => statusOf(k, now, before);
  const text = String(evalExpr(r.expr, now, before, status));
  const changed = exprKeys(r.expr).some(([k, b]) => valueOf({ key: k, base: b }, now) !== valueOf({ key: k, base: b }, before));
  const delta = showDelta && changed && r.dexpr ? String(evalExpr(r.dexpr, now, before, status)) : null;
  const d = delta !== null && r.bdelta && r.better ? evalExpr(r.bdelta, now, before, status) * r.better : 0;
  return { label: r.label, text, delta, better: d ? d > 0 : null };
}

function whenOk(r, now, before) {
  return !r.when || r.when.every((t) => evalExpr(t, now, before, (k) => statusOf(k, now, before)));
}

// ---------------------------------------------------------------- panel
export function computeStats(item, chosen, oc) {
  if (!item || !Array.isArray(item.stats) || !item.stats.length) return null;
  const base = effectsOf(chosen || []);
  const all = oc ? base.concat(effectsOf([oc])) : base;
  const ocEffects = oc ? effectsOf([oc]) : [];
  const rows = [];
  const lines = [];
  for (const r of item.stats) {
    if (r.if && !r.if.every((c) => isActive(c, all))) continue;
    if (!whenOk(r, all, all)) continue;
    if ("line" in r) {
      lines.push({ text: r.line, tone: r.tone });
      continue;
    }
    if ("expr" in r) {
      rows.push(exprRow(r, all, base, Boolean(oc)));
      continue;
    }
    if ("text" in r) {
      // shown like a preview that adds the overclock: PreviewStatus Previewed, a green delta
      const byOc = oc && r.up && (r.if || []).some((c) => !c.startsWith("!") && isActive(c, ocEffects));
      rows.push({ label: r.label, text: r.text, delta: byOc ? r.up : null, better: byOc ? true : null });
      continue;
    }
    if (!r.key) {
      rows.push({ label: r.label, text: formatStat(r.fmt, r.base, r.base, r.base, r.base)[0], delta: null, better: null });
      continue;
    }
    const now = valueOf(r, all);
    const before = valueOf(r, base);
    const [text, change] = formatStat(r.fmt, r.base, now, now, before, isActive(r.key, all));
    const changed = oc && now !== before && r.fmt !== 5 && r.fmt !== 6 && r.fmt !== 7;
    rows.push({
      label: r.label,
      text,
      delta: changed ? change : null,
      better: changed && r.better ? (now - before) * r.better > 0 : null,
    });
  }
  return { rows, lines };
}

// The game's preview while hovering an upgrade or an overclock: the panel of `next` ({ chosen, oc }), each
// row with its change from `cur` ({ chosen, oc }, the equipped build), e.g. "+10" on Magazine Size.
// Same result shape as computeStats; delta is null for rows that do not change.
// A row's conditions see the upgrades of both builds: the game's "has upgrades" is PreviewStatus != Normal,
// also true for an upgrade the hover removes (in game: "Electric Damage -2 0" while swapping the overclock).
// Colours follow the PreviewStatus (ITM_UpgGear_GearStat): what the hover adds is green (Previewed), what it
// removes red (PreviewReduced): fixed-text deltas, and "+ name" lines removed by the hover (tone "bad"; for a
// penalty line "oc"). A line the hover adds keeps its own tone.
export function compareStats(item, cur, next) {
  if (!item || !Array.isArray(item.stats) || !item.stats.length) return null;
  const eff = (b) => effectsOf((b.chosen || []).concat(b.oc ? [b.oc] : []));
  const was = eff(cur);
  const now = eff(next);
  const holds = (r, n, w) => !r.if || r.if.every((c) => condHolds(c, n, w));
  const rows = [];
  const lines = [];
  for (const r of item.stats) {
    if (!holds(r, now, was)) continue;
    if (!whenOk(r, now, was)) continue;
    const added = !holds(r, was, was) && holds(r, now, now);
    const removed = holds(r, was, was) && !holds(r, now, now);
    if ("line" in r) {
      const penalty = r.tone === "bad";
      // An added line keeps its colour (armor "+ AoE Damage On Shield Break" stays amber on hover, game
      // screenshot 2026-11-22); a removed one turns red.
      const tone = added ? r.tone : removed ? (penalty ? "oc" : "bad") : r.tone;
      lines.push({ text: r.line, tone });
      continue;
    }
    if ("expr" in r) {
      rows.push(exprRow(r, now, was, true));
      continue;
    }
    if ("text" in r) {
      // the text for the removed case ("down", e.g. "-20") is known only for rows on equipped upgrades
      if (!holds(r, now, now) && !(r.down && r.if.every((c) => !c.startsWith("!")))) continue;
      const delta = added && r.up ? r.up : removed ? r.down : null;
      rows.push({ label: r.label, text: r.text, delta, better: delta ? added : null });
      continue;
    }
    if (!r.key) {
      rows.push({ label: r.label, text: formatStat(r.fmt, r.base, r.base, r.base, r.base)[0], delta: null, better: null });
      continue;
    }
    const after = valueOf(r, now);
    const before = valueOf(r, was);
    const [text, change] = formatStat(r.fmt, r.base, after, after, before, isActive(r.key, now));
    const changed = after !== before && r.fmt !== 5 && r.fmt !== 6 && r.fmt !== 7;
    rows.push({
      label: r.label,
      text,
      delta: changed ? change : null,
      better: changed && r.better ? (after - before) * r.better > 0 : null,
    });
  }
  return { rows, lines };
}
