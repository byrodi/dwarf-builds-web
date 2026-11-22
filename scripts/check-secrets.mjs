// Secret scan of the files that get deployed (public/ and functions/). Exits 1 on any finding.
//   node scripts/check-secrets.mjs [dir ...]
// Looks for: private keys, key/token/secret/password assignments with long values, Cloudflare
// API token shapes, Steam Web API key shapes (32 hex), JWTs and other well-known token prefixes,
// the literal values of .dev.vars, secret-looking file names, and Windows machine paths.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DIRS = ["public", "functions"];
const MAX_FILE = 32 * 1024 * 1024;

const BAD_NAMES = [
  /^\.dev\.vars/i,
  /^\.env/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /^LocalConfig\.ini$/i,
  /^LocalModIOConfig\.ini$/i,
  /^credentials(\.json)?$/i,
  /\.(sqlite3?|db)(-wal|-shm)?$/i,
];

const SECRET_NAME = String.raw`(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?key|session[_-]?secret|bearer)`;

const RULES = [
  { name: "private key block", re: /-----BEGIN[ A-Z]*-----/g },
  {
    name: "secret assignment",
    // NAME = "value" / NAME: 'value' / "NAME": "value" / NAME=value (env style)
    re: new RegExp(String.raw`["']?[A-Za-z0-9_.-]*${SECRET_NAME}[A-Za-z0-9_-]*["']?\s*[:=]\s*["'\x60]?([A-Za-z0-9+/_=.-]{20,})`, "gi"),
    check: (m) => looksRandom(m[1]),
  },
  { name: "Steam Web API key shape (32 hex)", re: /(?<![A-Za-z0-9])[0-9A-Fa-f]{32}(?![A-Za-z0-9])/g },
  {
    name: "Cloudflare API token shape (40 chars)",
    re: /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40}(?![A-Za-z0-9_-])/g,
    check: (m) => looksRandom(m[0]) && entropy(m[0]) >= 4.3 && /[0-9].*[0-9].*[0-9]/.test(m[0]),
  },
  { name: "Cloudflare global API key shape (37 hex)", re: /(?<![A-Za-z0-9])[0-9a-f]{37}(?![A-Za-z0-9])/g },
  { name: "JWT", re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: "known token prefix", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35})\b/g },
  { name: "bearer header", re: /Bearer\s+[A-Za-z0-9._~+/-]{20,}/g },
  { name: "Windows machine path", re: /\b[A-Za-z]:(?:\\\\|\\|\/)+(?:Users|IdeaProjects|SteamLibrary|Program Files|Windows|Documents and Settings)\b/gi },
];

function entropy(s) {
  const n = new Map();
  for (const c of s) n.set(c, (n.get(c) || 0) + 1);
  let e = 0;
  for (const k of n.values()) e -= (k / s.length) * Math.log2(k / s.length);
  return e;
}

// Mixed letters and digits, no long lowercase words: random-looking rather than an identifier.
function looksRandom(s) {
  return /[0-9]/.test(s) && /[A-Za-z]/.test(s) && !/[a-z]{8,}/.test(s) && entropy(s) >= 3.5;
}

function devVarsValues(webDir) {
  const out = [];
  for (const f of [".dev.vars"]) {
    const p = path.join(webDir, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const v = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
      // Short values ("1", "true") are flags, not secrets; ADMIN ids are public Steam ids.
      if (v.length >= 6 && m[1] !== "ADMIN_STEAM_IDS") out.push({ name: m[1], value: v });
    }
  }
  return out;
}

function machineWords() {
  const words = new Set();
  try {
    const u = os.userInfo().username;
    if (u && u.length >= 4) words.add(u.toLowerCase());
  } catch {
    // no user info
  }
  const home = path.basename(os.homedir() || "");
  if (home.length >= 4) words.add(home.toLowerCase());
  return [...words];
}

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function mask(s) {
  return s.length <= 8 ? "***" : `${s.slice(0, 4)}...(${s.length} chars)`;
}

// Scans text; returns findings { rule, line, sample }.
export function scanText(text, { devValues = [], words = [] } = {}) {
  const found = [];
  for (const r of RULES) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(text))) {
      if (r.check && !r.check(m)) continue;
      found.push({ rule: r.name, line: lineOf(text, m.index), sample: mask(m[0]) });
      if (found.length > 50) return found;
    }
  }
  for (const d of devValues) {
    let i = text.indexOf(d.value);
    if (i >= 0) found.push({ rule: `value of ${d.name} from .dev.vars`, line: lineOf(text, i), sample: "***" });
  }
  const lower = words.length ? text.toLowerCase() : "";
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i >= 0) found.push({ rule: "machine user name", line: lineOf(text, i), sample: "***" });
  }
  return found;
}

// Scans directories; returns findings { file, rule, line, sample }.
export function scanDirs(dirs, { webDir = WEB, devValues, words } = {}) {
  devValues = devValues || devVarsValues(webDir);
  words = words || machineWords();
  const findings = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const rel = path.relative(webDir, file).split(path.sep).join("/");
      const base = path.basename(file);
      if (BAD_NAMES.some((re) => re.test(base))) findings.push({ file: rel, rule: "secret-looking file name", line: 0, sample: base });
      const st = fs.statSync(file);
      if (st.size > MAX_FILE) {
        findings.push({ file: rel, rule: "file too large to scan", line: 0, sample: String(st.size) });
        continue;
      }
      const buf = fs.readFileSync(file);
      // Binary files (PNG text chunks, a copied .sqlite) are scanned too, byte for byte as latin1.
      const text = buf.toString(isBinary(buf) ? "latin1" : "utf8");
      for (const f of scanText(text, { devValues, words })) findings.push({ file: rel, ...f });
    }
  }
  return findings;
}

function main() {
  const args = process.argv.slice(2);
  const dirs = (args.length ? args : DEFAULT_DIRS).map((d) => path.resolve(WEB, d));
  const findings = scanDirs(dirs);
  if (findings.length) {
    console.error(`check-secrets: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.rule}  ${f.sample}`);
    console.error("Remove them (or tune the rule narrowly in scripts/check-secrets.mjs) before deploying.");
    process.exit(1);
  }
  console.log(`check-secrets: ok (${dirs.map((d) => path.relative(WEB, d)).join(", ")})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
