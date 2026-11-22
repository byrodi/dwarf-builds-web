// Profanity check for public text (build titles and descriptions).
// English: the obscenity package (its word list, leet-speak and look-alike letters). Its word boundaries are
// ASCII only, so Russian has its own short list of roots below.

import { DataSet, RegExpMatcher, englishDataset, englishRecommendedTransformers, pattern } from "obscenity";

// Russian written in Latin letters, and game words the English list would catch.
const dataset = new DataSet()
  .addAll(englishDataset)
  .addPhrase((p) =>
    p
      .setMetadata({ originalWord: "russian" })
      .addPattern(pattern`blyat`)
      .addPattern(pattern`blyad`)
      .addPattern(pattern`|cyka|`)
      .addPattern(pattern`|suka|`)
      .addPattern(pattern`pizd`)
      .addPattern(pattern`pidor`)
      .addPattern(pattern`pidar`)
      .addPattern(pattern`mudak`)
      .addPattern(pattern`dolboeb`)
      .addPattern(pattern`|nahui|`)
      .addPattern(pattern`|nahuy|`)
      .addPattern(pattern`|hui|`)
      .addPattern(pattern`|huy|`)
      .addPattern(pattern`|xyu|`)
      .addWhitelistedTerm("cockpit")
  );
const english = new RegExpMatcher({ ...dataset.build(), ...englishRecommendedTransformers });

// Russian roots. Text is lower case, with "ё" as "е" and repeated letters collapsed. B and E are word edges.
const B = "(?<![а-я])";
const E = "(?![а-я])";
const RUSSIAN = [
  `${B}(?:на|по|до|ни|не|о|от|за|при|вы|с|рас|раз|архи)?ху(?:й|е|я|ю|и)`,
  `${B}хули${E}`,
  "п[еи]зд",
  `${B}(?:за|вы|у|на|до|по|про|недо|съ|въ|объ|отъ|разъ|подъ|долбо|дол[бп]а|злое|мозго)еб`,
  `${B}еб(?:а|у|л|н|ит|ет|еш|ыр|ищ|ок|ош|ен|ущ|и?${E})`,
  `${B}бля(?:[дт]|${E})`,
  "бляд",
  `${B}блеат`,
  `${B}сук(?:а|и|у|ой|е|ам|ами)${E}`,
  `${B}суч(?:к[ау]|ар)`,
  "муд(?:ак|ач|ил|озвон)",
  "(?<!ски)пид[оа]р",
  `${B}пидр`,
  `${B}педик`,
  "педераст",
  "г[ао]ндон",
  "залуп",
  "дроч",
  "шлюх",
  "говн",
  "жоп",
  "д[еи]рьм",
  `${B}(?:на|обо|за|про|вы|по|у)?сра[тлн]`,
  `${B}срак`,
  `${B}хер(?:а|у|ом|н[яюие]|ов|ач)?${E}`,
  `${B}(?:на|по|до|ни|о)хер`,
  `${B}чмо(?:шн|${E})`,
  `${B}нигер(?!и)`,
  `${B}нигг`,
  `${B}жид(?:ы|а|ов|у|ам)?${E}`,
  `${B}хач(?:и|ей|а)?${E}`,
].map((source) => new RegExp(source));

// Latin letters that look like Cyrillic ones: "xyй", "cyкa".
const LOOKALIKE = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у" };

function russianForm(text) {
  return text
    .toLowerCase()
    .replace(/[a-zа-яё]+/g, (word) => (/[а-яё]/.test(word) ? word.replace(/[a-z]/g, (c) => LOOKALIKE[c] || c) : word))
    .replace(/ё/g, "е")
    .replace(/([а-я])\1+/g, "$1");
}

// The first profane word of the text ("fuck", "хуй"), or null. Links are skipped: their ids are random letters.
export function findProfanity(text) {
  const s = String(text || "").replace(/https?:\/\/\S+/gi, " ");
  const hit = english.getAllMatches(s, true)[0];
  if (hit) return s.slice(hit.startIndex, hit.endIndex + 1);
  const ru = russianForm(s);
  for (const re of RUSSIAN) {
    const m = re.exec(ru);
    if (m) return /[а-я]*$/.exec(ru.slice(0, m.index))[0] + m[0] + /^[а-я]*/.exec(ru.slice(m.index + m[0].length))[0];
  }
  return null;
}
