import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanText, scanDirs } from "../scripts/check-secrets.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Fake secrets are built at run time so this file itself holds none in plain form.
const hex = (n, seed) => Array.from({ length: n }, (_, i) => "0123456789ABCDEF"[(i * 7 + seed) % 16]).join("");
const mixed = (n) => Array.from({ length: n }, (_, i) => "aZ3kQ9xR2mT7vB1nW5pL8cY4"[(i * 5 + 3) % 24]).join("");

test("finds secret shapes", () => {
  const cases = [
    `-----BEGIN ${"PRIVATE"} KEY-----`,
    `const apiKey = "${mixed(32)}";`,
    `"session_secret": "${mixed(24)}"`,
    `STEAM_API_KEY=${hex(32, 1)}`,
    `steam: "${hex(32, 3)}"`,
    `x = "${mixed(40)}"`,
    `${"eyJ"}hbGciOiJIUzI1NiJ9.${"eyJ"}zdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop`,
    `${"ghp_"}${mixed(36)}`,
    `path = "C:${"\\"}Users${"\\"}someone"`,
    `"D:/IdeaProjects/x"`,
    `"D:${"\\\\"}SteamLibrary${"\\\\"}x"`,
  ];
  for (const c of cases) assert.ok(scanText(c).length > 0, c);
});

test("does not flag normal code and game data", () => {
  const ok = [
    `const token = readCookie(request, name);`,
    `"key": "driller", "id": "UPG_Flamethrower_A_ClipSize", "asset": "PERK_ManagementsFavorite"`,
    `"icon": "img/items/FlameThrower_line.png", "id": "OC_Flamethrower_ClipSize_B"`,
    `"guid": "AEABC8F1-4EDF327B-CF131A86-4162F4FB"`,
    `"version": "2026-11-22 experimental 26808185"`,
    `"color": "#379C5D"`,
    `const SECRET_NAME = "secret";`,
    `env.SESSION_SECRET`,
    `/api/users/76561197960287930`,
  ];
  for (const c of ok) assert.deepEqual(scanText(c), [], c);
});

test(".dev.vars values, file names and user name", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbsec-"));
  try {
    fs.mkdirSync(path.join(dir, "public", "js"), { recursive: true });
    fs.writeFileSync(path.join(dir, "public", "js", "a.js"), "const s = 'not-a-real-dev-value-xyz';");
    fs.writeFileSync(path.join(dir, "public", ".env.local"), "");
    fs.writeFileSync(path.join(dir, "public", "server.pem"), "");
    fs.writeFileSync(path.join(dir, "public", "b.txt"), "made by someuser1");
    fs.writeFileSync(path.join(dir, "public", "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]));
    // A binary file is scanned too: a token in a PNG text chunk, a copied local D1 file.
    fs.writeFileSync(path.join(dir, "public", "leak.png"),
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]), Buffer.from(`tEXt key=${"ghp_"}${mixed(36)}`), Buffer.from([0])]));
    fs.writeFileSync(path.join(dir, "public", "state.sqlite"), Buffer.from([0]));
    const f = scanDirs([path.join(dir, "public")], {
      webDir: dir,
      devValues: [{ name: "SESSION_SECRET", value: "not-a-real-dev-value-xyz" }],
      words: ["someuser1"],
    });
    const rules = f.map((x) => `${x.file} ${x.rule}`);
    assert.ok(rules.some((r) => /a\.js value of SESSION_SECRET/.test(r)), rules.join("\n"));
    assert.ok(rules.some((r) => /\.env\.local secret-looking file name/.test(r)));
    assert.ok(rules.some((r) => /server\.pem secret-looking file name/.test(r)));
    assert.ok(rules.some((r) => /b\.txt machine user name/.test(r)));
    assert.ok(!rules.some((r) => /img\.png/.test(r)));
    assert.ok(rules.some((r) => /leak\.png known token prefix/.test(r)), rules.join("\n"));
    assert.ok(rules.some((r) => /state\.sqlite secret-looking file name/.test(r)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the real public/ and functions/ pass", () => {
  const f = scanDirs([path.join(WEB, "public"), path.join(WEB, "functions")]);
  assert.deepEqual(f, []);
});
