/**
 * Which two English words the card Lint treats as the same word.
 *
 * @remarks
 * Ported from the reference validator (`tomada-routine`'s
 * `anki-vocabulary/scripts/validate_phrase_cards.py`), which deliberately
 * carries two comparisons rather than one shared "close enough":
 * {@link leaksAnswer} matches on a prefix, where being too eager only costs a
 * definition a human rewrites, while {@link missingHeadwordWords} matches on
 * real inflections, because being too eager there would accept `watches over`
 * as a use of `oversee` and let an example that never shows the word through.
 *
 * The word lists below are facts about English rather than tuning knobs, which
 * is why they live here and not in `lint-config.ts`.
 */

/**
 * The function words a rule never counts as content.
 *
 * @remarks
 * Without them a definition like `a job you do at the weekend` would count as
 * leaking the headword `side job`, because both share the ordinary word `job`.
 * Written as one string and split so the list reads as a list rather than as
 * sixty lines of array.
 */
const STOPWORDS = new Set(
  `a an the to of in on at for and or is are was were be been being so what i you
   he she it we they this that these those as with by from your my his her their
   our its do does did not no`.split(/\s+/),
);

/**
 * The stand-in words a headword may carry, such as `throw something out`.
 *
 * @remarks
 * An example replaces them with a real object, so their absence from it is the
 * headword being used correctly rather than a word that went missing. A bare
 * `one` is deliberately not here: it collides with the ordinary word.
 */
const PLACEHOLDERS = new Set(
  `something someone somebody sth sb oneself one's someone's somebody's
   somewhere`.split(/\s+/),
);

/**
 * The irregular verbs whose forms count as the same word.
 *
 * @remarks
 * One line per verb, base form first, so a diff adding one is one line.
 * Suffix-stripping alone would never connect `threw` to `throw`.
 */
const IRREGULAR_GROUPS: readonly ReadonlySet<string>[] = [
  "throw threw thrown",
  "wear wore worn",
  "grow grew grown",
  "go went gone",
  "break broke broken",
  "take took taken",
  "give gave given",
  "make made",
  "come came",
  "run ran",
  "get got gotten",
  "keep kept",
  "hold held",
  "stand stood",
  "bring brought",
  "pay paid",
  "sit sat",
  "drive drove driven",
  "leave left",
  "speak spoke spoken",
  "write wrote written",
  "fall fell fallen",
  "feel felt",
  "find found",
  "tell told",
  "think thought",
  "catch caught",
  "buy bought",
  "build built",
  "meet met",
  "lose lost",
  "send sent",
  "spend spent",
  "hear heard",
  "teach taught",
  "see saw seen",
  "do did done",
  "have had",
].map((group) => new Set(group.split(" ")));

/** Endings stripped when looking for the form a word was built from. */
const VARIANT_SUFFIXES = "ingly ing ies ied edly ed es s ly d e".split(" ");

/** A word, apostrophes kept so `one's` stays one token. */
const WORDS = /[A-Za-z']+/g;

/** The lowercased words of `text` that are not function words. */
export function contentWords(text: string): string[] {
  return (text.match(WORDS) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => !STOPWORDS.has(word));
}

/** The content words of `headword` an example is expected to show. */
export function headwordWords(headword: string): string[] {
  return contentWords(headword).filter((word) => !PLACEHOLDERS.has(word));
}

/**
 * Whether `a` and `b` are the same word, compared by their first few letters.
 *
 * @remarks
 * Deliberately rough: `train`/`trained`/`training` all share a stem, and so do
 * plenty of unrelated pairs. Only {@link leaksAnswer} reads it, where erring
 * towards "the same word" is the safe direction.
 */
function stemsMatch(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const length = Math.min(a.length, b.length, 5);
  return length >= 4 && a.slice(0, length) === b.slice(0, length);
}

/**
 * Whether `front` already carries every content word of `headword`.
 *
 * @remarks
 * A multi-word headword leaks only when all of its words are on the front:
 * a definition of `side job` is entitled to use the word `job`, and treating
 * that single overlap as a leak would reject the natural wording. A one-word
 * headword leaks on that word alone.
 *
 * @param front - The `definition` and the `cloze`, joined.
 */
export function leaksAnswer(front: string, headword: string): boolean {
  const answer = contentWords(headword);
  if (answer.length === 0) {
    return false;
  }
  const haystack = contentWords(front);
  return answer.every((word) => haystack.some((other) => stemsMatch(word, other)));
}

/**
 * The forms `word` could also be written as.
 *
 * @remarks
 * The suffix is stripped, a doubled final consonant undone (`rubb` → `rub`),
 * a dropped `e` restored (`jok` → `joke`), and an irregular verb's whole group
 * pulled in. Two words are the same word when their sets overlap.
 */
function wordVariants(word: string): Set<string> {
  const base = word.toLowerCase().replaceAll("'", "");
  const variants = new Set([base]);
  for (const suffix of VARIANT_SUFFIXES) {
    if (base.endsWith(suffix) && base.length - suffix.length >= 2) {
      variants.add(base.slice(0, -suffix.length));
    }
  }
  for (const variant of [...variants]) {
    const last = variant.at(-1) ?? "";
    if (variant.length >= 3 && last === variant.at(-2) && !"aeiou".includes(last)) {
      variants.add(variant.slice(0, -1));
    }
    variants.add(`${variant}e`);
  }
  for (const group of IRREGULAR_GROUPS) {
    if ([...variants].some((variant) => group.has(variant))) {
      for (const form of group) {
        variants.add(form);
      }
    }
  }
  return variants;
}

/**
 * The content words of `headword` that `example` does not use in any form.
 *
 * @remarks
 * An empty result means the example shows the whole headword; a result as long
 * as the headword means it shows none of it.
 */
export function missingHeadwordWords(headword: string, example: string): string[] {
  const answer = headwordWords(headword);
  if (answer.length === 0) {
    return [];
  }
  const used = contentWords(example).map(wordVariants);
  return answer.filter((word) => {
    const forms = wordVariants(word);
    return !used.some((other) => [...other].some((form) => forms.has(form)));
  });
}
