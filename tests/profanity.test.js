import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { findProfanity } from "../functions/_lib/profanity.js";

const BAD = [
  "fuck you", "FUUUCK", "f*ck", "sh1t build", "cyka blyat", "Suka", "nahui",
  "хуй", "ХУЙ", "нахуй", "похуй", "дохуя", "охуенный билд", "хуйня", "хуёвый", "хули ты", "пиздец", "спиздил",
  "ебать", "ёб твою мать", "заебись", "уёбок", "долбоёб", "блять", "бля", "блядь", "выблядок", "сука", "сучка",
  "мудак", "пидор", "гандон", "залупа", "дрочить", "шлюха", "говно", "жопа", "дерьмо", "насрать", "засранец",
  "хер", "нахер", "херня", "чмо", "xyй", "cyка", "хууууй", "ниггер",
];

// Ordinary words that hold a profane root, and game words.
const GOOD = [
  "COMBAT", "Scunthorpe driller", "glass cannon", "cockpit view", "Hellfire", "Fat Boy", "Lead Storm",
  "застрахуй", "подстрахуй меня", "психую", "хлеба", "колебался", "небанальный билд", "оскорблять", "употреблять",
  "рубля", "корабля", "сабля", "себя", "себе", "похудеть", "хулиган", "Херсон", "хачапури", "жидкий азот",
  "Нигерия", "сравнить", "сражение", "учеба", "поезд", "звезда", "скипидар", "барсук", "чмокнуть", "пострадал",
  "ухудшить", "хороший билд для хаз 5",
];

test("findProfanity: catches English and Russian profanity", () => {
  for (const text of BAD) assert.ok(findProfanity(text), text);
  assert.equal(findProfanity("so fuck you"), "fuck");
  assert.equal(findProfanity("полный Пиздец тут"), "пиздец");
});

test("findProfanity: leaves ordinary words, links and empty text alone", () => {
  for (const text of GOOD) assert.equal(findProfanity(text), null, text);
  assert.equal(findProfanity("video: https://youtu.be/assfuckcum123 here"), null);
  assert.equal(findProfanity(""), null);
  assert.equal(findProfanity(undefined), null);
});

test("findProfanity: no name in the game data is caught", (t) => {
  const file = new URL("../public/data/game.json", import.meta.url);
  if (!fs.existsSync(file)) return t.skip("public/data/game.json is not exported");
  const caught = [];
  (function walk(v) {
    if (typeof v === "string") {
      if (v.length < 200 && findProfanity(v)) caught.push(v);
    } else if (v && typeof v === "object") for (const k in v) walk(v[k]);
  })(JSON.parse(fs.readFileSync(file, "utf8")));
  assert.deepEqual(caught, []);
});
