import { ECHO_MIN_FRAGMENT_LEN } from "./lint-config";

/**
 * The text-level helpers the card Lint's rules are written in terms of.
 *
 * @remarks
 * Ported from the shared helpers of the reference validator
 * (`tomada-routine`'s `anki-router/scripts/cardgate.py`): how a word is
 * counted, what counts as CJK, which marks are forbidden, and how the cloze
 * blank is found. They answer questions about a piece of text and know nothing
 * about a card, which is what keeps `lint.ts` a list of rules.
 */

/** What the cloze writes its blank as. */
export const BLANK = "___";

/**
 * Marks no field may carry.
 *
 * @remarks
 * A reader cannot tell an ellipsis meaning "something is left out" from one
 * meaning "the sentence was never finished", so neither is allowed anywhere.
 */
export const FORBIDDEN_MARKS = ["...", "…"] as const;

/** A run of underscores, whatever its length: the blank as written. */
const UNDERSCORE_RUN = /_+/;

/** Every run of underscores, for counting the blanks a cloze holds. */
const UNDERSCORE_RUNS = /_+/g;

/**
 * Hiragana and katakana, and the three CJK ideograph blocks.
 *
 * @remarks
 * The same ranges the reference validator uses, written as escapes so this
 * file stays ASCII and a reader can check a bound without a font for it. A
 * card is English on every side, so one character from any of them is enough
 * to report.
 */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

/**
 * A character that makes a whitespace-separated token a word.
 *
 * @remarks
 * Unicode-aware, matching the reference's Python `\w`, so text in another
 * script is still counted rather than silently scoring zero words.
 */
const WORD_CHARACTER = /[\p{L}\p{N}_']/u;

/**
 * How many words `text` holds.
 *
 * @remarks
 * Split on whitespace, then drop the tokens that carry no word character at
 * all. Punctuation is never split on: `trade-off` and `O(n)` are one spoken
 * unit each, and replacing punctuation with a space would count them as two.
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((token) => WORD_CHARACTER.test(token)).length;
}

/** Whether `text` carries a single CJK character. */
export function containsCjk(text: string): boolean {
  return CJK.test(text);
}

/** The first forbidden mark `text` carries, or `undefined` when it carries none. */
export function findForbiddenMark(text: string): string | undefined {
  return FORBIDDEN_MARKS.find((mark) => text.includes(mark));
}

/**
 * Whether `cloze` holds exactly one blank, written exactly as {@link BLANK}.
 *
 * @remarks
 * Every run of underscores counts as an attempt at a blank, so `__` and `____`
 * are reported rather than read as one: a card whose blank is the wrong width
 * renders as a different prompt, and two blanks have two answers.
 */
export function hasOneBlank(cloze: string): boolean {
  const runs = cloze.match(UNDERSCORE_RUNS) ?? [];
  return runs.length === 1 && runs[0] === BLANK;
}

/**
 * `text` lowercased with everything but letters and digits removed.
 *
 * @remarks
 * For comparing two pieces of text while ignoring spacing and punctuation.
 */
export function normalizeAlnum(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Whether `example` is `cloze` with the blank filled in.
 *
 * @remarks
 * The cloze is split at its blank and each side normalized; the fragments
 * shorter than {@link ECHO_MIN_FRAGMENT_LEN} are dropped as too common to mean
 * anything. When every fragment that is left appears in the example, the
 * example is the cloze sentence again and the back of the card repeats its
 * front. An echo rewritten with an inflection or a synonym is not caught here
 * and is left to `reviewing-cards`, which is where judgment lives.
 */
export function echoesCloze(cloze: string, example: string): boolean {
  if (!UNDERSCORE_RUN.test(cloze)) {
    return false;
  }
  const fragments = cloze
    .split(UNDERSCORE_RUNS)
    .map(normalizeAlnum)
    .filter((fragment) => fragment.length >= ECHO_MIN_FRAGMENT_LEN);
  if (fragments.length === 0) {
    return false;
  }
  const normalized = normalizeAlnum(example);
  return fragments.every((fragment) => normalized.includes(fragment));
}
