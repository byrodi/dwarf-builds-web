import nodeTest from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compareStats, computeStats, formatNumber, formatStat } from "../public/js/stats.js";

// Real export (Tools/dwarfbuilds_export.py; generated, not in git: skipped when missing).
// Expected numbers are from the game's own panel unless noted.
const GAME = new URL("../public/data/game.json", import.meta.url);
const game = fs.existsSync(GAME) ? JSON.parse(fs.readFileSync(GAME, "utf8")) : null;
const test = game ? nodeTest : nodeTest.skip;

function item(id) {
  for (const c of game.classes) {
    for (const list of Object.values(c.slots)) for (const it of list) if (it.id === id) return it;
    if (c.flare && c.flare.id === id) return c.flare;
  }
  throw new Error("no item " + id);
}

// picks: option id per tier (null for none), oc id or null
function panel(id, picks, ocId = null) {
  const it = item(id);
  const chosen = it.tiers.map((t, i) => t.options.find((o) => o.id === picks[i]) || null);
  const oc = ocId ? it.overclocks.find((o) => o.id === ocId) : null;
  if (ocId) assert.ok(oc, "no overclock " + ocId);
  return computeStats(it, chosen, oc);
}

const table = (p) => p.rows.map((r) => [r.label, r.text]);
// rows as the game shows them while previewing: "label: delta value"
const preview = (p) => p.rows.map((r) => `${r.label}: ${r.delta ? r.delta + " " : ""}${r.text}`);

function build(id, picks, ocId = null) {
  const it = item(id);
  const chosen = it.tiers.map((t, i) => t.options.find((o) => o.id === picks[i]) || null);
  const oc = ocId ? it.overclocks.find((o) => o.id === ocId) : null;
  if (ocId) assert.ok(oc, "no overclock " + ocId);
  return { chosen, oc };
}

// Voltaic SMG ("Stubby"), ground truth from the user's game (beta). (A): T1 Upgraded Capacitors, T2 High
// Capacity Magazine, T3 High Velocity Rounds, T4 Conductive Bullets, T5 Improved Accuracy, EM Refire Booster.
const SMG_A = [
  "UPG_ElectricSMG_A_ElectrocuteChance",
  "UPG_ElectricSMG_B_ClipSize",
  "UPG_ElectricSMG_C_Damage",
  "UPG_ElectricSMG_D_DamageVsElectrocuted",
  "UPG_ElectricSMG_E_Accuracy",
];
// (B): no T2 choice, T5 Electric Arc (the "Electrocution AoE %" row), no overclock
const SMG_B = [SMG_A[0], null, SMG_A[2], SMG_A[3], "UPG_ElectricSMG_ElectricAoE"];
const SMG_B_HCM = [SMG_A[0], SMG_A[1], SMG_A[2], SMG_A[3], SMG_B[4]];

test("SMG (A): equipped build matches the game (built-in 25 % electrocution + 25 %)", () => {
  const p = panel("SMG", SMG_A, "OC_SMG_RoF_U");
  assert.deepEqual(table(p), [
    ["Electrocution %", "+50%"],
    ["Damage", "12"],
    ["Electric Damage", "2"],
    ["Magazine Size", "40"],
    ["Max Ammo", "420"],
    ["Rate of Fire", "15"],
    ["Reload Time", "2"],
    ["Base Spread", "90%"],
    ["Damage vs Electrically Affected", "+25%"],
  ]);
  assert.deepEqual(p.lines, []); // no "+ EM Refire Booster" line
});

test("SMG (A1): hovering Turret EM Discharge from EM Refire Booster", () => {
  const it = item("SMG");
  const p = compareStats(it, build("SMG", SMG_A, "OC_SMG_RoF_U"), build("SMG", SMG_A, "OC_SMG_Turret-AoE-Discharge_U"));
  assert.deepEqual(preview(p), [
    "Electrocution %: +50%",
    "Damage: -2 10",
    "Electric Damage: -2 0", // removed by the hover: still listed (PreviewStatus != Normal)
    "Magazine Size: -5 35",
    "Max Ammo: 420",
    "Rate of Fire: -4 11",
    "Reload Time: 2",
    "Base Spread: -30% 60%",
    "Damage vs Electrically Affected: +25%",
  ]);
  assert.deepEqual(p.lines, [{ text: "Turret EM Discharge", tone: "oc" }]);
});

test("SMG (B): hovering High Capacity Magazine", () => {
  const p = compareStats(item("SMG"), build("SMG", SMG_B), build("SMG", SMG_B_HCM));
  assert.deepEqual(preview(p), [
    "Electrocution %: +50%",
    "Damage: 12",
    "Magazine Size: +10 40",
    "Max Ammo: 420",
    "Rate of Fire: 11",
    "Reload Time: 2",
    "Electrocution AoE %: +25%",
    "Damage vs Electrically Affected: +25%",
  ]);
  assert.equal(p.rows[2].better, true);
});

test("SMG (B1): hovering Micro-Conductor Add-On", () => {
  const p = compareStats(item("SMG"), build("SMG", SMG_B_HCM), build("SMG", SMG_B_HCM, "OC_SMG_ConductorBullets_U"));
  assert.deepEqual(preview(p), [
    "Electrocution %: +50%",
    "Damage: 12",
    "Magazine Size: 40",
    "Max Ammo: -120 300",
    "Rate of Fire: -2 9",
    "Reload Time: 2",
    "Micro-Conductor Effect Duration: 20 20",
    "Electrocution AoE %: +25%",
    "Damage vs Electrically Affected: +25%",
  ]);
  assert.deepEqual(p.lines, [{ text: "Micro-Conductor Add-On", tone: "oc" }]);
  // the "20" delta is green in game: the row's PreviewStatus is Previewed
  assert.equal(p.rows.find((r) => r.label === "Micro-Conductor Effect Duration").better, true);
});

test("SMG: hovering another overclock while Micro-Conductor is equipped (WPN_SMG_OneHand bytecode)", () => {
  // PreviewReduced: the Blueprint shows "20" with "-20"; the panel colours it and the "+ name" line red
  const p = compareStats(item("SMG"), build("SMG", SMG_B_HCM, "OC_SMG_ConductorBullets_U"),
    build("SMG", SMG_B_HCM, "OC_SMG_SpreadDampener"));
  const row = p.rows.find((r) => r.label === "Micro-Conductor Effect Duration");
  assert.deepEqual(row, { label: "Micro-Conductor Effect Duration", text: "20", delta: "-20", better: false });
  assert.deepEqual(p.lines, [{ text: "Micro-Conductor Add-On", tone: "bad" }]);
  // kept while hovering a tier upgrade: listed without a delta, line in its usual tone
  const same = compareStats(item("SMG"), build("SMG", SMG_B, "OC_SMG_ConductorBullets_U"),
    build("SMG", SMG_B_HCM, "OC_SMG_ConductorBullets_U"));
  assert.equal(same.rows.find((r) => r.label === "Micro-Conductor Effect Duration").delta, null);
  assert.deepEqual(same.lines, [{ text: "Micro-Conductor Add-On", tone: "oc" }]);
});

test("SMG (B2): hovering Hyperalloy Assembly (recoil rows: V and H instead of the combined one)", () => {
  const p = compareStats(item("SMG"), build("SMG", SMG_B), build("SMG", SMG_B, "OC_SMG_SpreadDampener"));
  assert.deepEqual(preview(p), [
    "Electrocution %: +50%",
    "Damage: 12",
    "Magazine Size: -10 20",
    "Max Ammo: 420",
    "Rate of Fire: 11",
    "Reload Time: 2",
    "Vertical Recoil: +50% 150%",
    "Horizontal Recoil: -80% 20%",
    "Base Spread: -70% 30%",
    "Weakpoint Damage Bonus: +30% +30%",
    "Electrocution AoE %: +25%",
    "Damage vs Electrically Affected: +25%",
  ]);
  const v = p.rows.find((r) => r.label === "Vertical Recoil");
  assert.equal(v.better, false); // red in game
  // only the combined row while no V/H upgrade is set ("a|b" / "!a" conditions in the game data)
  const damp = table(panel("SMG", [null, "UPG_ElectricSMG_B_Recoil", null, null, null])).map((r) => r[0]);
  assert.ok(damp.includes("Recoil") && !damp.includes("Vertical Recoil"), damp.join(", "));
});

test("autocannon: Base Spread rounded to tens by the Blueprint (RoundStatValue)", () => {
  const t = (picks, oc) => Object.fromEntries(table(panel("Autocannon", picks, oc)));
  assert.equal(t([null, "UPG_AutoCannon_B_Accuracy_NEW"])["Base Spread"], "70%");
  const p = panel("Autocannon", [null, "UPG_AutoCannon_B_Accuracy_NEW"], "OC_Autocannon_DamageBig_U");
  const row = p.rows.find((r) => r.label === "Base Spread");
  assert.equal(row.text, "50%"); // 0.7 x 0.7 = 49 % -> 50 %
  assert.equal(row.delta, "-20%"); // -21 % -> -20 %
  // the rounded entry keeps the spread entry's PreviewStatus (WPN_AutoCannon bytecode): lower is better
  assert.equal(row.better, true);
  const hover = compareStats(item("Autocannon"), build("Autocannon", [null, "UPG_AutoCannon_B_Accuracy_NEW"]),
    build("Autocannon", [null, "UPG_AutoCannon_B_Accuracy_NEW"], "OC_Autocannon_DamageBig_U"));
  assert.deepEqual(hover.rows.find((r) => r.label === "Base Spread"),
    { label: "Base Spread", text: "50%", delta: "-20%", better: true });
  assert.equal(t([])["Top Rate of Fire"], "5.5"); // AAutoCannon.MaxFireRate (game data)
  assert.equal(t([null, null, null, null, "UPG_AutoCannon_E_FulRoFBonus"])["Top RoF Damage Bonus"], "+10%");
});

test("combat shotgun: stun rows hidden when an upgrade sets the chance to 0 (value condition)", () => {
  const base = Object.fromEntries(table(panel("CombatShotgun", [])));
  assert.equal(base["Pellets"], "8");
  assert.equal(base["Weakpoint Stun Chance Per Pellet"], "10%");
  assert.equal(base["Weakpoint Stun Duration"], "3");
  const mini = table(panel("CombatShotgun", [], "OC_CombatShotgun_MiniShells_U")).map((r) => r[0]);
  assert.ok(!mini.some((l) => l.startsWith("Weakpoint Stun")), mini.join(", "));
});

test("new items: real values from the game data", () => {
  const t = (id, picks, oc) => Object.fromEntries(table(panel(id, picks, oc)));
  assert.equal(t("DualMPs", [])["Combined Clip Size"], "50"); // label joined by the Blueprint
  assert.equal(t("Gatling", [])["Max Ammo"], "2,400"); // the Blueprint relabels the clip row
  const g = t("GrapplingGun", ["UPG_GrapplingGun_A_Cooldown", null, null, "UPG_GrapplingGun_D_FallDamageReduction"]);
  assert.equal(g["Max Range"], "20");
  assert.equal(g["Cooldown"], "3.5"); // CoolDownItemAggregator 4 s - 0.5
  assert.ok("Fall damage reduction after release" in g && !("Faster movement after release" in g));
  const c = t("Cryospray", [], "OC_Cryospray_Snowball_U");
  assert.equal(c["Freezing Power"], "8"); // built-in flat cold damage
  assert.equal(c["Cold Stream Reach"], "10");
  assert.equal(c["Repressurization Delay"], "2");
  assert.ok("Snowball" in c);
  const f = t("FlameThrower", ["UPG_FlameThrower_A_RangeIncrease", "UPG_Flamethrower_B_StickyDuration"]);
  assert.equal(f["Heat"], "10");
  assert.equal(f["Flame Reach"], "15");
  assert.equal(f["Sticky Flame Duration"], "5"); // spawner FlameLifetime 2 + 3
  assert.equal(t("MicroMissileLauncher", [null, "UPG_MML_B_MoreSpeedMoreControl"])["Projectile Velocity"], "150%");
  assert.equal(t("Pistol", [null, null, null, null, "UPG_Pistol_E_DamageVsBurning"])["Bonus Fire Damage to Burning Targets"], "+50%");
  assert.equal(t("Revolver", [], "OC_Revolver_RoF_B")["Damage Vs Burning"], "+300%");
  const goo = t("GooCannon", []);
  assert.equal(goo["Effects Duration"], "4"); // the projectile's dynamic status effect, 4 s
  assert.equal(goo["Puddle Lifespan"], "12");
  assert.ok("Charged Splash Damage" in goo && !("Blast Fragment Damage" in goo)); // if/else on an overclock
});

test("cryospray: Damage from DamageComponent (6), not the AoE component listed first in the package", () => {
  const t = (picks, oc) => Object.fromEntries(table(panel("Cryospray", picks, oc)));
  assert.equal(t([])["Damage"], "6");
  // Hard Mixture +3, Ice Storm x2: (6 + 3) x 2
  assert.equal(t([null, null, null, "UPG_Cryospray_D_Damage_New"], "OC_Cryospray_IceStorm_U")["Damage"], "18");
});

test("goo cannon: upgrades on a parent projectile class apply to the row's projectile (RequiredClass)", () => {
  const t = (picks, oc) => Object.fromEntries(table(panel("GooCannon", picks, oc)));
  assert.equal(t([])["Puddle Radius"], "0.7");
  assert.equal(t(["UPG_Goo_A_AoERadius"])["Puddle Radius"], "0.9"); // 70 x 1.25 on PRJ_BaseGooProjectile_C
  assert.equal(t([null, "UPG_Goo_B_ChargeDamage"])["Charged Splash Damage"], "72"); // 48 + 24
  assert.equal(t([], "OC_GC_Disperser_B")["Charged Splash Damage"], "24"); // 48 - 24
  assert.equal(t([], "OC_GooCannon_Buckshot2_U")["Blast Fragment Damage"], "24"); // 48 x 0.5
});

nodeTest("expression rows, value conditions and OR conditions", () => {
  const it = {
    stats: [
      { label: "Spread", expr: ["cat", ["itext", ["*", ["round", ["*", ["num", ["text", "k", 1, 8, 0]], 0.1]], 10], false, true], "%"],
        dexpr: ["cat", ["itext", ["-", ["round", ["val", "k", 1]], ["round", ["old", "k", 1]]], true, true], ""] },
      { label: "Hidden at 0", fmt: 0, base: 1, key: "z", when: [["not", ["and", ["<=", ["val", "z", 1], 0], ["==", ["status", "z"], 1]]]] },
      { line: "Either", tone: "upgrade", if: ["a|b"] },
    ],
  };
  const o = (effects) => ({ effects });
  let p = computeStats(it, [o([["k", 0.49, 1]])], null);
  assert.deepEqual(p.rows[0], { label: "Spread", text: "50%", delta: null, better: null });
  assert.equal(p.rows[1].text, "1");
  assert.deepEqual(p.lines, []);
  p = computeStats(it, [o([["z", -1, 0]]), o([["b"]])], null);
  assert.deepEqual(p.rows.map((r) => r.label), ["Spread"]);
  assert.deepEqual(p.lines, [{ text: "Either", tone: "upgrade" }]);
  p = compareStats(it, { chosen: [o([["z", -1, 0]])] }, { chosen: [o([["z", -1, 0]])], oc: o([["z", 1, 0]]) });
  assert.deepEqual(preview(p), ["Spread: 100%", "Hidden at 0: +1 1"]);
});

nodeTest("expression ops fstr (SanitizeFloat) and pct (product of the percentage amounts)", () => {
  const it = {
    stats: [
      { label: "Float", expr: ["fstr", ["val", "k", 450]] },
      { label: "Pct", expr: ["itext", ["*", ["pct", "m", false], 100], false, false],
        dexpr: ["itext", ["*", ["-", ["pct", "m", false], ["pct", "m", true]], 100], true, false],
        better: -1, bdelta: ["-", ["pct", "m", false], ["pct", "m", true]] },
    ],
  };
  const o = (effects) => ({ effects });
  let p = computeStats(it, [o([["k", 0.25, 0]])], null);
  assert.deepEqual(p.rows.map((r) => r.text), ["450.25", "100"]);
  p = compareStats(it, { chosen: [] }, { chosen: [o([["m", 0.5, 1], ["k", -450, 0]])] });
  assert.deepEqual(preview(p), ["Float: 0.0", "Pct: -50 50"]);
  assert.equal(p.rows[1].better, true); // lower is better and it went down
});

test("pickaxe with Power Attack and the damage upgrade matches the game", () => {
  const p = panel("PickAxe_Scout", ["UPG_Pickaxe_Scout_A_PowerAttack", "UPG_Pickaxe_Scout_B_DamagePA"]);
  assert.deepEqual(table(p), [
    ["Damage", "25"],
    ["Armor Breaking", "150%"],
    ["Power Attack Area Damage", "240"],
    ["Power Attack Effect Radius", "1"],
    ["Power Attack Stun Chance", "50%"],
    ["Power Attack Stun Duration", "1.5"],
    ["Power Attack Cooldown", "30"],
  ]);
  assert.deepEqual(p.lines, []);
  assert.ok(p.rows.every((r) => r.delta === null));
});

test("pickaxe without Power Attack shows only the base rows", () => {
  const p = panel("PickAxe_Scout", [null, null]);
  assert.deepEqual(table(p), [["Damage", "25"], ["Armor Breaking", "150%"]]);
  const cd = panel("PickAxe_Engineer", ["UPG_Pickaxe_Eng_A_PowerAttack", "UPG_Pickaxe_Eng_B_CooldownPA"]);
  assert.equal(cd.rows.find((r) => r.label === "Power Attack Cooldown").text, "20"); // 30 - 10 (game data)
});

test("pheromone canister matches the game", () => {
  assert.deepEqual(table(panel("Grenade_Pheromone", [])), [
    ["Carried Amount", "4"],
    ["Duration", "15"],
    ["Effect Radius", "4"],
  ]);
});

// The user's DRAK-25 build (upgrades worked out from the screenshot): A velocity, B battery, C accuracy,
// D Electrocution, E Thermal Feedback Loop, overclock Transfer Heat to Projectiles (unstable).
const DRAK = [
  "UPG_PlasmaCarbine_A_ProjectileVelocity",
  "UPG_PlasmaCarbine_B_Ammo",
  "UPG_PlasmaCarbine_C_Accuracy",
  "UPG_PlasmaCarbine_E_ElectrocutionChance",
  "UPG_PlasmaCarbine_D_ThermalFeedbackLoop",
];

test("DRAK-25 build reproduces the game's panel", () => {
  const p = panel("PlasmaCarbine", DRAK, "OC_PlasmaCarbine_HeatBuildUpDamage_U");
  assert.deepEqual(table(p), [
    ["Direct Damage", "9"],
    ["Rate of Fire", "12"],
    ["Battery Capacity", "950"],
    ["Projectile Velocity", "200%"],
    ["Overheat Duration", "3.2"], // 2.5 * 1.3 in 32-bit floats = 3.2499998
    ["Cooldown Delay", "0.3"],
    ["Heat Per Shot", "120%"],
    ["Shot Spread", "30%"],
  ]);
  assert.deepEqual(p.lines, [
    { text: "Faster RoF When Hot", tone: "upgrade" },
    { text: "Chance to Electrocute on Hit", tone: "upgrade" },
    { text: "Transfer Heat to Projectiles", tone: "oc" },
  ]);
  const heat = p.rows.find((r) => r.label === "Overheat Duration");
  assert.equal(heat.delta, "+0.8"); // without the overclock 2.5
  assert.equal(heat.better, false); // lower is better
  assert.equal(p.rows.find((r) => r.label === "Heat Per Shot").delta, "+20%");
  assert.equal(p.rows.find((r) => r.label === "Battery Capacity").delta, null);
});

test("DRAK-25 overclock deltas: Aggressive Venting", () => {
  const p = panel("PlasmaCarbine", DRAK, "OC_PlasmaCarbine_OverheatAoE_B");
  const heat = p.rows.find((r) => r.label === "Overheat Duration");
  assert.equal(heat.text, "2");
  assert.equal(heat.delta, "-0.5");
  assert.equal(heat.better, true);
  assert.equal(p.rows.find((r) => r.label === "Heat Per Shot"), undefined); // no heat change: row hidden
  assert.deepEqual(p.lines.at(-1), { text: "Aggressive Venting", tone: "oc" });
});

test("DRAK-25 without upgrades: base values from the game data", () => {
  const p = panel("PlasmaCarbine", [null, null, null, null, null]);
  assert.deepEqual(table(p), [
    ["Direct Damage", "9"],
    ["Rate of Fire", "12"],
    ["Battery Capacity", "750"],
    ["Overheat Duration", "2.5"],
    ["Cooldown Delay", "0.3"],
  ]);
  assert.deepEqual(p.lines, []);
});

test("static overclock rows show their game text and preview value", () => {
  const p = panel("PlasmaCarbine", [null, null, null, null, null], "OC_PlasmaCarbine_ElementalWeakness");
  const row = p.rows.find((r) => r.label === "Bonus Duration Per Shot");
  // green like a preview that adds the overclock (PreviewStatus Previewed, ITM_UpgGear_GearStat)
  assert.deepEqual(row, { label: "Bonus Duration Per Shot", text: "10", delta: "10", better: true });
  assert.equal(p.rows.find((r) => r.label === "Direct Damage").text, "6"); // 9 - 3
  assert.equal(p.rows.find((r) => r.label === "Direct Damage").delta, "-3");
  assert.deepEqual(p.lines[0], { text: "Conductive Thermals", tone: "oc" });
});

test("flare gun: added amounts sum up (game data: 12 + 3 + 3, 3 + 1, 75 s)", () => {
  const p = panel("FlareGun", ["UPG_FlareGun_A_MaxAmmo", "UPG_FlareGun_B_ClipSize", "UPG_FlareGun_C_MaxAmmo_2"]);
  const t = Object.fromEntries(table(p));
  assert.equal(t["Duration"], "75");
  assert.equal(t["Magazine Size"], "4");
  assert.equal(t["Max Ammo"], "18");
  assert.equal(t["Auto Reload"], undefined); // only with the auto reload upgrade
  const d = panel("FlareGun", ["UPG_FlareGun_A_Duration", null, "UPG_FlareGun_C_Duration_2"]);
  assert.equal(Object.fromEntries(table(d))["Duration"], "105");
});

test("cluster grenade: bomblet rows from its fragment projectile (game data)", () => {
  assert.deepEqual(table(panel("Grenade_Cluster", [])), [
    ["Carried Amount", "4"],
    ["Bomblets", "9"],
    ["Bomblet Area Damage", "40"],
    ["Bomblet Effect Radius", "3.8"], // 385 cm / 100 in 32-bit floats = 3.8499999 (not checked in game)
    ["Bomblet Stun Chance", "50%"],
    ["Bomblet Stun Duration", "1.5"],
  ]);
});

test("charge blaster: Burning Nightmare rows only with that upgrade (if/else branches in the game data)", () => {
  const none = table(panel("ChargeBlaster", [null, null, null, null, null])).map((r) => r[0]);
  assert.ok(none.includes("Charged Effect Radius"));
  assert.ok(!none.some((l) => l.startsWith("Burning Nightmare")), none.join(", "));
  const nm = table(panel("ChargeBlaster", [null, null, null, null, "UPG_ChargeBlaster_E_Nightmare"]));
  const labels = nm.map((r) => r[0]);
  assert.ok(labels.includes("Burning Nightmare Radius") && labels.includes("Burning Nightmare Damage"));
  assert.ok(!labels.includes("Charged Effect Radius") && !labels.includes("Charged Damage"));
  assert.equal(Object.fromEntries(nm)["Burning Nightmare Radius"], "0.6"); // 200 cm x 0.3
});

// Boomstick, ground truth from the user's game screenshots (2026-11-22)
const BOOM_FULL = [
  "UPG_SawedOff_A_Ammo+6", // Expanded Ammo Bags
  "UPG_SawedOff_B_RoF", // Double Trigger
  "UPG_SawedOff_C_Ammo+10", // Expanded Ammo Bags
  "UPG_SawedOff_D_ArmorDamage", // Tungsten Coated Buckshot
  "UPG_SawedOff_E_DragonsBreath", // White Phosphorus Shells
];

test("Boomstick: default panel matches the game", () => {
  assert.deepEqual(table(panel("SawedOffShotgun", [])), [
    ["Damage", "12"],
    ["Pellets", "8"],
    ["Front AoE Shockwave Area Damage", "20"],
    ["Max Ammo", "24"],
    ["Magazine Size", "2"],
    ["Rate of Fire", "1.5"],
    ["Reload Time", "2"],
    ["Per Pellet Stun Chance", "30%"],
    ["Stun Duration", "2.5"],
  ]);
});

test("Boomstick: hovering Expanded Ammo Bags, then Compact Shells with it equipped", () => {
  const it = item("SawedOffShotgun");
  const t1 = [BOOM_FULL[0]];
  const a = preview(compareStats(it, build("SawedOffShotgun", []), build("SawedOffShotgun", t1)));
  assert.ok(a.includes("Max Ammo: +8 32"), a.join(" | "));
  const b = preview(compareStats(it, build("SawedOffShotgun", t1), build("SawedOffShotgun", t1, "OC_SawedOff_MaxAmmo_C")));
  assert.ok(b.includes("Max Ammo: +6 38") && b.includes("Reload Time: -0.2 1.8"), b.join(" | "));
});

test("Boomstick: full build with Compact Shells matches the game", () => {
  assert.deepEqual(table(panel("SawedOffShotgun", BOOM_FULL, "OC_SawedOff_MaxAmmo_C")), [
    ["Damage", "12"],
    ["Damage % as Fire", "50%"],
    ["Pellets", "8"],
    ["Front AoE Shockwave Area Damage", "20"],
    ["Max Ammo", "50"],
    ["Magazine Size", "2"],
    ["Rate of Fire", "9"],
    ["Reload Time", "1.8"],
    ["Per Pellet Stun Chance", "30%"],
    ["Stun Duration", "2.5"],
    ["Armor Breaking", "400%"],
  ]);
});

test("Boomstick: Improved Blast Wave adds to the front shockwave (RequiredClass is the item itself)", () => {
  const p = Object.fromEntries(table(panel("SawedOffShotgun", [null, null, null, "UPG_SawedOff_D_Damage-BlastWave"])));
  assert.equal(p["Front AoE Shockwave Area Damage"], "40"); // 20 + 20
});

test("Boomstick: upgrades for the item itself do not change the Shockwave Amplifier projectile row", () => {
  const p = Object.fromEntries(table(panel("SawedOffShotgun", [null, null, null, "UPG_SawedOff_D_Damage-BlastWave"], "OC_SawedOff_HighPressureRounds_U")));
  assert.equal(p["Area Damage"], "5"); // PRJ_HighPressureRounds_C, not + 20 + 90
  assert.equal(p["Front AoE Shockwave Area Damage"], "130"); // 20 + 20 + 90
});

// Items supported since the 2026-11-22 pass. Real values from the game data (not checked in game; the
// inferred bases are listed in Docs/dwarfbuilds-site.md section 3).
test("burst pistol: Burst Stun row only with the upgrade (0 + 4 s)", () => {
  const none = table(panel("BurstPistol", []));
  assert.deepEqual(none, [
    ["Damage", "21"],
    ["Burst Size", "3"], // the native base is BurstCount + 1 (game exe): 2 + 1
    ["Max Ammo", "120"],
    ["Magazine Size", "24"],
    ["Rate of Fire", "3"],
    ["Reload Time", "2.2"],
    ["Armor Breaking", "50%"],
  ]);
  const p = table(panel("BurstPistol", [null, null, null, null, "UPG_BurstPistol_E_Stagger"]));
  assert.deepEqual(p.at(-1), ["Burst Stun Duration", "4"]);
  const longer = Object.fromEntries(table(panel("BurstPistol", [null, null, null, null, "UPG_BurstPistol_LongBurst_E"])));
  assert.equal(longer["Burst Size"], "6"); // 3 + 3
});

test("coil gun: trajectory, shockwave and trail rows", () => {
  const p = panel("CoilGun", [null, null, "UPG_Coilgun_C_StunTrail", "UPG_Coilgun_D_Shockwave", "UPG_Coilgun_ContrailWidth_50"]);
  assert.deepEqual(table(p), [
    ["Damage", "130"],
    ["Max Ammo", "680.0"], // the Blueprint's own FloatToString
    ["Charged Shot Ammo Use", "40"],
    ["Charge Speed", "100%"],
    ["Reload Time", "1.9"],
    ["Trajectory Effect Radius", "1.5"],
    ["Trajectory Stun Chance", "50%"],
    ["Trajectory Stun Duration", "3"],
    ["Front AoE shock wave Damage", "20"],
    ["Trail Radius", "1"],
    ["Trail Duration", "5"],
  ]);
  assert.deepEqual(p.lines, [{ text: "Damage Trail", tone: "upgrade" }]);
});

test("crossbow: special bolt rows follow the equipped special bolt (branch in GetEquippedSpecialArrow)", () => {
  const p = panel("Crossbow", ["UPG_Crossbow_A_SpecialPheromone", "UPG_Crossbow_B_IncreaseSpecialAmmo", null, null, "UPG_Crossbow_E_SpecialDuration"]);
  assert.deepEqual(table(p), [
    ["Damage", "105"],
    ["Radial Damage", "60"],
    ["Max Ammo", "20"],
    ["Projectile Velocity", "100%"],
    ["Special Ammo", "13"], // (0 + 9) x 1.4
    ["Special Effect Duration", "12.5"], // pheromone bolt 10 s x 1.25
    ["Reload Time", "1.6"],
  ]);
  const chem = Object.fromEntries(table(panel("Crossbow", ["UPG_Crossbow_A_SpecialChemical"])));
  assert.equal(chem["Special Effect Duration"], "14");
  const it = item("Crossbow");
  const r = preview(compareStats(it, build("Crossbow", []), build("Crossbow", [null, null, "UPG_Crossbow_C_FasterReload"])));
  assert.ok(r.includes("Reload Time: -0.4 1.2"), r.join(" | "));
});

test("crossbow: Special Effect Duration reads the equipped bolt, not the hovered one", () => {
  const it = item("Crossbow");
  const row = (cur, next) => compareStats(it, cur, next).rows.find((x) => x.label === "Special Effect Duration");
  const taser = build("Crossbow", ["UPG_Crossbow_A_SpecialTaser"]);
  assert.equal(row(taser, build("Crossbow", ["UPG_Crossbow_A_SpecialPheromone"])).text, "12"); // Taser's 12 s
  // nothing equipped: the native gets no projectile and gives 0 (game exe)
  assert.equal(row(build("Crossbow", []), taser).text, "0");
});

test("crossbow: Reload Time is red when one of its two values gets worse (Get Reload Stat)", () => {
  const it = item("Crossbow");
  const quick = build("Crossbow", [], "OC_Crossbow_QuickFire");
  const r = compareStats(it, quick, build("Crossbow", [], "OC_Crossbow_QuickFireMechanism"));
  const reload = r.rows.find((x) => x.label === "Reload Time");
  // reload speed +0.2 (worse), default bolt reload -0.8 (better): the sum is better, the game shows red
  assert.deepEqual([reload.delta, reload.text, reload.better], ["-0.6", "0.8", false]);
  const faster = compareStats(it, build("Crossbow", []), build("Crossbow", [null, null, "UPG_Crossbow_C_FasterReload"]));
  assert.equal(faster.rows.find((x) => x.label === "Reload Time").better, true);
});

test("satchel charge: carve diameter and radii from the charge (DetPackClass)", () => {
  assert.deepEqual(table(panel("DetPack", [null, null, null, "UPG_DetPack_D_BiggerCarve"])), [
    ["Area Damage", "375"],
    ["Effect Radius", "4.5"],
    ["Carried Amount", "2"],
    ["Carve Diameter", "15.2"], // 625 + 900 cm
    ["Extra Fear Radius", "0"],
    ["Extra Stagger Radius", "0"],
  ]);
});

test("grenade launcher: Supercell Area DPS and Manual Detonator stages", () => {
  const s = table(panel("GrenadeLauncher", [], "OC_PGL_SupercellPayload_U"));
  assert.deepEqual(s[0], ["Area DPS", "92"]); // 110 x 0.35 x 1.2 / 0.5 s
  assert.ok(!s.some((r) => r[0] === "Area Damage"));
  const m = Object.fromEntries(table(panel("GrenadeLauncher", [], "OC_PGL_ManualDetonator_B")));
  assert.equal(m["Area Damage Every 1s"], "+40");
  assert.equal(m["Effect Radius Every 1s"], "+0.5m");
  assert.equal(m["Max Area Damage"], "190");
  assert.equal(m["Max Effect Radius"], "4.5m");
});

test("springloaded ripper: impact damage and duration", () => {
  assert.deepEqual(table(panel("Grenade_WallSaw", [])), [
    ["Carried Amount", "6"],
    ["Impact Damage", "145"],
    ["Duration", "7.75"],
  ]);
});

test("shard diffractor: Direct Target Heating starts at its built-in 25 %", () => {
  assert.equal(Object.fromEntries(table(panel("HeavyParticleCannon", [])))["Direct Target Heating"], "25%");
  const p = Object.fromEntries(table(panel("HeavyParticleCannon", [null, null, null, "UPG_HPC_D_Heat"])));
  assert.equal(p["Direct Target Heating"], "100%");
  // Shield Transfer Module: ConversionPercentage 0 with IsPercentage, heat x 0
  const it = item("HeavyParticleCannon");
  const oc = it.overclocks.find((o) => o.id === "OC_HeavyParticleCannon_ShieldTransferModule_U");
  const none = build("HeavyParticleCannon", []);
  const heat = compareStats(it, none, { ...none, oc }).rows.find((x) => x.label === "Direct Target Heating");
  assert.deepEqual([heat.delta, heat.text], ["-25%", "0%"]);
});

test("breach cutter: Beam DPS and projectile rows", () => {
  assert.deepEqual(table(panel("LineCutter", [])).slice(0, 4), [
    ["Beam DPS", "575"], // 11.5 / 0.02 s
    ["Plasma Beam Width", "1.5"],
    ["Projectile Lifetime", "1.5"],
    ["Plasma Expansion Delay", "0.2"],
  ]);
  const p = Object.fromEntries(table(panel("LineCutter", ["UPG_LineCutter_A_ProjectileLife", "UPG_LineCutter_B_Linesize"], "OC_LineCutter_HighSpeed_B")));
  assert.equal(p["Beam DPS"], "604");
  assert.equal(p["Plasma Beam Width"], "3");
  assert.equal(p["Projectile Lifetime"], "3");
  assert.equal(p["Damage Bonus Per Second"], "10");
  assert.equal(p["Max Damage Bonus"], "30");
});

test("M1000: Electrocuting Focus Shots", () => {
  const p = panel("M1000", [], "OC_M1000_FocusElectrocute_U");
  const t = Object.fromEntries(table(p));
  assert.equal(t["Focused Shot Damage Bonus"], "+75%");
  assert.equal(t["Focused Shot Electrocutes"], "0");
  assert.deepEqual(p.lines, [{ text: "Electrocuting Focus Shots", tone: "oc" }]);
});

test("microwave gun: Sinusoidal Amplifier shows high and low damage instead of Damage", () => {
  const p = table(panel("MicrowaveGun", [], "OC_SinusoidalAmplifierV2"));
  assert.deepEqual(p.slice(0, 2), [["High Damage", "16"], ["Low Damage", "4"]]); // 7 - 3 + 12, 7 - 3 + 0
  assert.ok(!p.some((r) => r[0] === "Damage"));
  assert.deepEqual(table(panel("MicrowaveGun", []))[0], ["Damage", "7"]);
});

test("microwave gun: Shot Width is twice the capsule's Width (game exe), Gamma Contamination -50", () => {
  assert.equal(Object.fromEntries(table(panel("MicrowaveGun", [])))["Shot Width"], "120");
  const it = item("MicrowaveGun");
  const none = build("MicrowaveGun", []);
  const r = preview(compareStats(it, none, build("MicrowaveGun", [], "OC_MicrowaveGun_GammaContamination")));
  assert.ok(r.includes("Shot Width: -50 70"), r.join(" | "));
});

test("platform gun: flag upgrade rows only when equipped", () => {
  assert.equal(table(panel("PlatformGun", [])).length, 4);
  assert.deepEqual(table(panel("PlatformGun", [null, "UPG_PlatformGun_C_LessFallDamage"])).at(-1), ["Less fall damage", "0"]);
  // "Should show text" is PreviewStatus != 0 and != 3: hidden while hovering a build without it
  const it = item("PlatformGun");
  const rep = build("PlatformGun", [null, null, "UPG_PlatformGun_D_BugRepellant"]);
  const swap = compareStats(it, rep, build("PlatformGun", [null, null, "UPG_PlatformGun_D_MaxAmmo_Large"]));
  assert.ok(!swap.rows.some((x) => x.label === "Bug repellant"));
  assert.ok(compareStats(it, build("PlatformGun", []), rep).rows.some((x) => x.label === "Bug repellant"));
});

test("LMG gun platform: sentry rows from the sentry class and its reload usable", () => {
  assert.deepEqual(table(panel("SentryGun", [])), [
    ["Carried Amount", "425"],
    ["Construction Time", "4"],
    ["Sentry Ammo Capacity", "90"],
    ["Reload Ammo Per Second", "45"],
    ["Damage", "6"],
    ["Max Targeting Range", "20"],
    ["Number of Sentries", "1"],
  ]);
  const p = Object.fromEntries(table(panel("SentryGun", ["UPG_SentryGun_A_ExtraSentry", "UPG_SentryGun_B_ReloadSpeed", "UPG_SentryGun_C_TurretCapacity", "UPG_SentryGun_D_ManualTargeting"])));
  assert.equal(p["Sentry Ammo Capacity"], "120");
  assert.equal(p["Reload Ammo Per Second"], "90");
  assert.equal(p["Max Targeting Range"], "35");
  assert.equal(p["Number of Sentries"], "2");
  assert.equal(p["Hawkeye System"], "");
});

test("shield generator: carried amount from the second capacity component", () => {
  assert.deepEqual(table(panel("ShieldGenerator", ["UPG_ShieldGenerator_A_DeployTime", "UPG_ShieldGenerator_B_Duration", "UPG_ShieldGenerator_C_LeaveSTE"])), [
    ["Carried Amount", "1"],
    ["Shield Radius", "2.8"],
    ["Duration", "9"],
    ["Shield Regen per second", "10"],
    ["Recharge Time", "11.5"],
    ["Protection Time After Leaving", ""],
  ]);
});

test("zipline launcher: the projectile class of an upgrade is not a sub item requirement", () => {
  assert.equal(Object.fromEntries(table(panel("ZiplineGun", [])))["Movement speed"], "250"); // exe constant
  const fast = Object.fromEntries(table(panel("ZiplineGun", [null, null, "UPG_ZiplineGun_D_MovementSpeed"])));
  assert.equal(fast["Movement speed"], "325");
  const safe = table(panel("ZiplineGun", [null, null, "UPG_ZiplineGun_D_FallDamage"]));
  assert.deepEqual(safe.at(-1), ["Fall Damage Reduction", ""]);
});

test("items without stats data give null", () => {
  assert.equal(computeStats({ id: "x" }, [], null), null);
  assert.equal(computeStats({ id: "x", stats: [] }, [], null), null);
});

test("every item with stats computes with no upgrades and with every overclock", () => {
  let n = 0;
  for (const c of game.classes) {
    for (const it of [...Object.values(c.slots).flat(), c.flare]) {
      if (!it || !it.stats) continue;
      n++;
      for (const oc of [null, ...it.overclocks]) {
        const p = computeStats(it, it.tiers.map((t) => t.options[0]), oc);
        assert.ok(p.rows.length + p.lines.length > 0, it.id);
        for (const r of p.rows) {
          assert.equal(typeof r.text, "string", it.id + " " + r.label);
          assert.ok(!/NaN|Infinity/.test(r.text + r.delta), it.id + " " + r.label);
        }
      }
    }
  }
  assert.ok(n >= 25, "items with stats: " + n);
});

nodeTest("number text like the game (en, half to even, grouping)", () => {
  assert.equal(formatNumber(3.2499998, 1), "3.2");
  assert.equal(formatNumber(2.5, 0), "2");
  assert.equal(formatNumber(3.5, 0), "4");
  assert.equal(formatNumber(1200, 0), "1,200");
  assert.equal(formatNumber(-1.25, 1), "-1.2");
  assert.equal(formatNumber(0.8, 1, true), "+0.8");
  assert.equal(formatNumber(-0.01, 1, true), "+0");
  assert.deepEqual(formatStat(8, 1, 1.5, 1.5, 1.5), ["150%", "+0%"]);
  assert.deepEqual(formatStat(4, 400, 400, 400, 400), ["4", "+0"]);
  assert.deepEqual(formatStat(10, 4.5, 1.35, 1.35, 4.5), ["30%", "-70%"]);
  assert.deepEqual(formatStat(12, 1, 1.2, 1.2, 1), ["+20%", "+20%"]);
});

// Armor: hand-made table (Tools/gamedata/stats.py ARMOR_ROWS) from the user's game screenshots, 2026-11-22.
test("armor: default panel, hovers and the class-specific T3 row match the game", () => {
  const rows = (r) => r.rows.map((x) => (x.delta ? `${x.label}: ${x.delta} ${x.text}` : `${x.label}: ${x.text}`));
  const gun = item("Armor_Gunner");
  const none = gun.tiers.map(() => null);
  assert.deepEqual(rows(computeStats(gun, none, null)), ["Shield: 25", "Health: 125", "Regeneration Delay: 7",
    "Regeneration Rate: +100%", "Revive Invulnerability: 3", "Carry Capacity: 40"]);
  const hover = (it, chosen, t, i) => {
    const next = chosen.slice();
    next[t] = it.tiers[t].options[i];
    return compareStats(it, { chosen, oc: null }, { chosen: next, oc: null });
  };
  const conv = hover(gun, none, 0, 1);
  assert.equal(rows(conv)[2], "Regeneration Delay: +2 9");
  assert.equal(conv.rows[2].better, false);
  assert.equal(rows(conv)[3], "Regeneration Rate: +100% +200%");
  assert.equal(rows(hover(gun, none, 2, 0))[6], "Explosion Resistance: +50% +50%");
  assert.deepEqual(hover(gun, none, 3, 0).lines, [{ text: "AoE Damage On Shield Break", tone: "upgrade" }]);
  const fox = item("Armor_Scout");
  const built = [fox.tiers[0].options[0], fox.tiers[1].options[1], null, fox.tiers[3].options[2]];
  assert.deepEqual(rows(computeStats(fox, built, null)).slice(1, 5), ["Health: 145", "Regeneration Delay: 6",
    "Regeneration Rate: +100%", "Revive Invulnerability: 6"]);
  assert.equal(rows(hover(fox, built, 2, 0))[6], "Fall Damage Reduction: +33% +33%");
});
