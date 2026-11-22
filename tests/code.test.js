import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseCode,
  encodeCode,
  validateBuild,
  buildFromJson,
  classByLetter,
  itemBySlot,
  perkById,
  describeCode,
  codeProblem,
} from "../public/js/shared/code.js";

const game = JSON.parse(fs.readFileSync(new URL("./fixtures/game.sample.json", import.meta.url), "utf8"));
const vectors = JSON.parse(fs.readFileSync(new URL("./code_vectors.json", import.meta.url), "utf8"));
const FULL = "DB1:D:1-21321-4:2-12213-0:1-3112-0:1-2121-0:1-2112-0:3--0:1-12-0:2.3.5.4.8.34";
const clone = (x) => JSON.parse(JSON.stringify(x));

test("parse a full code", () => {
  const b = parseCode(FULL);
  assert.equal(b.class, "D");
  assert.equal(b.slots.length, 7);
  assert.deepEqual(b.slots[0], { item: 1, tiers: [2, 1, 3, 2, 1], oc: 4 });
  assert.deepEqual(b.slots[5], { item: 3, tiers: [], oc: 0 });
  assert.deepEqual(b.slots[6], { item: 1, tiers: [1, 2], oc: 0 });
  assert.deepEqual(b.perks, [2, 3, 5, 4, 8, 34]);
});

test("encode(parse(code)) round trip", () => {
  assert.equal(encodeCode(parseCode(FULL)), FULL);
  assert.equal(encodeCode(parseCode("DB1:S:1-0-0:0--0:0--0:0--0:0--0:0--0:0--0:")), "DB1:S:1-0-0:0--0:0--0:0--0:0--0:0--0:0--0:");
});

test("doc example parses", () => {
  const b = parseCode("DB1:S:2-21321-4:1-12213-0:1-3122-0:1-213-0:2-2132-0:3--0:1-13-0:12.7.21.15.36");
  assert.equal(b.class, "S");
  assert.deepEqual(b.perks, [12, 7, 21, 15, 36]);
});

test("missing parts are 0, extra parts and digits are ignored", () => {
  const b = parseCode("DB1:S:2-21-3:1");
  assert.deepEqual(b.slots[0], { item: 2, tiers: [2, 1], oc: 3 });
  assert.deepEqual(b.slots[1], { item: 1, tiers: [], oc: 0 });
  assert.deepEqual(b.slots[2], { item: 0, tiers: [], oc: 0 });
  assert.deepEqual(b.perks, []);
  const v = validateBuild(b, game);
  assert.ok(v.ok, v.errors.join());
  assert.equal(v.canonical, "DB1:S:2-21000-3:1-00000-0:0--0:0--0:0--0:0--0:0--0:");
  const x = validateBuild("DB1:D:1-213219-4-7:0--0:0--0:0--0:0--0:3-5-0:0--0::EXTRA:9", game);
  assert.ok(x.ok, x.errors.join());
  assert.equal(x.canonical, "DB1:D:1-21321-4:0--0:0--0:0--0:0--0:3--0:0--0:");
});

test("malformed codes are rejected", () => {
  for (const bad of [
    null,
    undefined,
    42,
    "",
    "DB1",
    "DB1:",
    "DB1:X:1-1-1",
    "DB2:D:1-1-1",
    "TB1:D:1-1-1",
    "DB1:D:0--0:0--0:0--0:0--0:0--0:0--0:0--0:1.2",
    "DB1:D",
    "DB1:D:1-1-1:<script>",
    "DB1:D:1-1-1 extra words",
    "DB1:D:" + "1".repeat(500),
    "DB1:D:1-١-1",
  ]) {
    assert.equal(parseCode(bad), null, String(bad));
    assert.equal(typeof codeProblem(bad), "string", String(bad));
  }
  assert.equal(codeProblem(FULL), null);
  assert.match(validateBuild("DB1:X:1-1-1", game).errors[0], /unknown class "X"/);
  assert.match(validateBuild("TB1:D:1-1-1", game).errors[0], /must start with DB1/);
});

test("lower case and whitespace are accepted", () => {
  assert.equal(validateBuild("  db1:d:1-21321-4:0--0:0--0:0--0:0--0:0--0:0--0:  ", game).canonical, "DB1:D:1-21321-4:0--0:0--0:0--0:0--0:0--0:0--0:");
});

test("non-numeric fields read as 0", () => {
  const b = parseCode("DB1:D:1-2A1-X:B--0");
  assert.deepEqual(b.slots[0], { item: 1, tiers: [2, 0, 1], oc: 0 });
  assert.equal(b.slots[1].item, 0);
});

test("validate: out of range item, tier, overclock", () => {
  let v = validateBuild("DB1:D:9-00000-0:0--0:0--0:0--0:0--0:0--0:0--0:", game);
  assert.equal(v.ok, false);
  v = validateBuild("DB1:D:1-90000-0:0--0:0--0:0--0:0--0:0--0:0--0:", game);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /tier 1 has no option 9/);
  v = validateBuild("DB1:D:1-30000-0:0--0:0--0:0--0:0--0:0--0:0--0:", game); // FlameThrower tier 1 has 2 options
  assert.equal(v.ok, false);
  v = validateBuild("DB1:D:1-00000-99:0--0:0--0:0--0:0--0:0--0:0--0:", game);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /no overclock 99/);
  v = validateBuild("DB1:D:1-00000-0:0--0:0--0:0--0:0--0:0--0:1-14-0:", game); // pickaxe tier 2 has 3 options
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /pickaxe: tier 2 has no option 4/);
  v = validateBuild("DB1:E:1-00000-0:0--0:0--0:0--0:0--0:0--0:0--0:", game); // class not in the fixture
  assert.equal(v.ok, false);
});

test("validate: perk rules", () => {
  const base = "DB1:D:1-00000-0:0--0:0--0:0--0:0--0:0--0:0--0:";
  const ok = (p) => validateBuild(base + p, game);
  assert.ok(ok("2.3.5.4.8.34").ok);
  assert.equal(ok("2.3.5.6").ok, false, "4 passive");
  assert.equal(ok("1.4.8").ok, false, "3 active");
  assert.equal(ok("34.35").ok, false, "2 proficiencies");
  assert.equal(ok("2.2").ok, false, "duplicate");
  assert.equal(ok("999").ok, false, "unknown");
  const v = ok("34.4.2.8.3.5");
  assert.ok(v.ok);
  assert.equal(v.canonical, base + "2.3.5.4.8.34", "order passive, active, proficiency");
  assert.deepEqual(v.buildJson.perks, ["PERK_DeepPockets", "PERK_ExpertDepositor", "PERK_RedSugarRocks", "PERK_FieldMedic", "PERK_IronWill", "Proficiency_Combat"]);
});

test("validate: buildJson has stable names", () => {
  const v = validateBuild(FULL, game);
  assert.ok(v.ok, v.errors.join());
  const p = v.buildJson.slots.primary;
  assert.equal(p.item, "FlameThrower");
  assert.equal(p.tiers.length, 5);
  assert.ok(p.tiers.every((t) => typeof t === "string" && t.startsWith("UPG_")));
  assert.match(p.oc, /^OC_/);
  assert.equal(v.buildJson.slots.grenade.tiers.length, 0);
  assert.deepEqual(v.buildJson.slots.pickaxe, { item: "PickAxe_Driller", tiers: ["UPG_Pickaxe_Driller_A_PowerAttack", "UPG_Pickaxe_Driller_B_RadiusPA"], oc: null });
  const empty = validateBuild("DB1:D:1-00000-0:0--0:0--0:0--0:0--0:0--0:0--0:", game).buildJson;
  assert.equal(empty.slots.secondary, null);
  assert.deepEqual(empty.slots.primary.tiers, [null, null, null, null, null]);
  assert.equal(empty.slots.primary.oc, null);
});

test("buildFromJson gives the same code on the same data", () => {
  for (const vec of vectors) {
    const v = validateBuild(vec.code, game);
    const r = buildFromJson(v.buildJson, game);
    assert.equal(r.code, vec.code, vec.note);
    assert.deepEqual(r.missing, []);
  }
});

test("buildFromJson follows reordered items, options and overclocks", () => {
  const v = validateBuild(FULL, game);
  const g2 = clone(game);
  const d = g2.classes.find((c) => c.letter === "D");
  // New primary inserted at the front; FlameThrower moves to index 2.
  d.slots.primary.unshift({ ...clone(d.slots.primary[1]), id: "NewGun", name: "New Gun" });
  d.slots.primary.forEach((it, i) => (it.index = i + 1));
  const flame = d.slots.primary[1];
  flame.tiers[0].options.reverse();
  flame.tiers[0].options.forEach((o, i) => (o.index = i + 1));
  flame.overclocks.reverse();
  flame.overclocks.forEach((o, i) => (o.index = i + 1));
  g2.version = "next";
  const r = buildFromJson(v.buildJson, g2);
  assert.deepEqual(r.missing, []);
  const b = parseCode(r.code);
  assert.equal(b.slots[0].item, 2);
  assert.equal(b.slots[0].tiers[0], 3 - 2); // option 2 of 2 became option 1
  assert.equal(b.slots[0].oc, flame.overclocks.length - 4 + 1);
  assert.equal(r.code.split(":").slice(3).join(":"), FULL.split(":").slice(3).join(":"));
});

test("buildFromJson reports removed things", () => {
  const v = validateBuild(FULL, game);
  const g2 = clone(game);
  const d = g2.classes.find((c) => c.letter === "D");
  d.slots.primary[0].overclocks = [];
  g2.perks = g2.perks.filter((p) => p.asset !== "PERK_IronWill");
  const r = buildFromJson(v.buildJson, g2);
  assert.ok(r.code);
  assert.equal(parseCode(r.code).slots[0].oc, 0);
  assert.ok(r.missing.some((m) => /overclock/.test(m)));
  assert.ok(r.missing.some((m) => /PERK_IronWill/.test(m)));
});

test("vectors: parse, canonical encode, validate", () => {
  assert.ok(vectors.length >= 10);
  for (const vec of vectors) {
    const v = validateBuild(vec.input || vec.code, game);
    assert.ok(v.ok, `${vec.note}: ${v.errors.join()}`);
    assert.equal(v.canonical, vec.code, vec.note);
    assert.deepEqual(v.build, vec.build, vec.note);
    assert.equal(encodeCode(vec.build), vec.code, vec.note);
    assert.match(vec.code, /^[A-Z0-9:.\-]+$/);
    if (!vec.input) assert.deepEqual(parseCode(vec.code), vec.build, vec.note);
  }
});

test("helpers", () => {
  assert.equal(classByLetter(game, "d").name, "Driller");
  assert.equal(classByLetter(game, "X"), null);
  assert.equal(itemBySlot(game, "D", "primary", 1).id, "FlameThrower");
  assert.equal(itemBySlot(game, "D", 0, 2).id, "Cryospray");
  assert.equal(itemBySlot(game, "D", "primary", 9), null);
  assert.equal(perkById(game, 1).asset, "PERK_Berzerker");
  assert.deepEqual(describeCode(FULL, game), { className: "Driller", primary: "CRSPR Flamethrower" });
  assert.equal(describeCode("hello", game), null);
});
