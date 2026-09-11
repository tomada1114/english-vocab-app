import type { Card } from "./card";
import {
  MAX_CLOZE_WORDS,
  MAX_EXAMPLE_WORDS,
  MAX_FRONT_WORDS,
  MAX_HEADWORD_WORDS,
  RECOMMENDED_EXAMPLE_WORDS,
} from "./lint-config";
import type { LintRule, Report } from "./lint-finding";
import {
  BLANK,
  containsCjk,
  countWords,
  echoesCloze,
  findForbiddenMark,
  hasOneBlank,
  normalizeAlnum,
} from "./lint-text";
import { headwordWords, leaksAnswer, missingHeadwordWords } from "./lint-words";

/**
 * The rules about a card's own text, as opposed to its identity and its tags.
 *
 * @remarks
 * These are the rules ported from the reference validator, and they are the
 * bulk of the Lint: every one of them reads a single card and nothing else,
 * which is what lets `lint.ts` stay the entry point and the rules that need to
 * see the whole directory. `lintCards` is the only caller.
 */

/** Every text a rule may read, each with the name a message calls it by. */
function textFields(card: Card): readonly (readonly [string, string])[] {
  return [
    ["id", card.id],
    ["headword", card.headword],
    ["definition", card.definition],
    ["cloze", card.cloze],
    ["examples[0]", card.examples[0]],
    ["examples[1]", card.examples[1]],
    ...card.topics.map((topic, at) => [`topics[${String(at)}]`, topic] as const),
    ...card.purposes.map((id, at) => [`purposes[${String(at)}]`, id] as const),
  ];
}

/** The rules every field answers to, whatever that field is for. */
export function checkFields(card: Card, report: Report): void {
  for (const [name, value] of textFields(card)) {
    if (value.trim() === "") {
      report("E_SCHEMA", `${name} is whitespace rather than text.`);
    }
    const mark = findForbiddenMark(value);
    if (mark !== undefined) {
      report("E_FORBIDDEN_MARK", `${name} contains "${mark}".`);
    }
    if (containsCjk(value)) {
      report("E_HAS_CJK", `${name} carries CJK text; a card is English.`);
    }
  }
}

/** What the reader sees before flipping: the definition and the cloze. */
export function checkFront(card: Card, report: Report): void {
  if (!hasOneBlank(card.cloze)) {
    report("E_CLOZE_BLANK", `cloze does not hold exactly one ${BLANK}.`);
  }
  if (leaksAnswer(`${card.definition} ${card.cloze}`, card.headword)) {
    report("E_ANSWER_LEAK", `the front carries "${card.headword}" or a form of it.`);
  }
  const front = countWords(card.definition) + countWords(card.cloze);
  reportLength(report, "E_FRONT_TOO_LONG", "the front", front, MAX_FRONT_WORDS);
  const cloze = countWords(card.cloze);
  reportLength(report, "E_CLOZE_TOO_LONG", "cloze", cloze, MAX_CLOZE_WORDS);
  const headword = countWords(card.headword);
  reportLength(report, "E_HEADWORD_TOO_LONG", "headword", headword, MAX_HEADWORD_WORDS);
}

/**
 * Reports `rule` when `what` runs past `limit`, and says whether it did.
 *
 * @remarks
 * Every length rule reads the same way, and the caller that has both an ERROR
 * limit and a WARN one below it asks for the second only when the first held.
 */
function reportLength(
  report: Report,
  rule: LintRule,
  what: string,
  words: number,
  limit: number,
): boolean {
  if (words <= limit) {
    return false;
  }
  report(rule, `${what} is ${String(words)} words, over ${String(limit)}.`);
  return true;
}

/** What the reader sees after flipping: the two example sentences. */
export function checkExamples(card: Card, report: Report): void {
  if (normalizeAlnum(card.examples[0]) === normalizeAlnum(card.examples[1])) {
    report("E_EXAMPLES_IDENTICAL", "the two examples are the same sentence.");
  }
  const expected = headwordWords(card.headword);
  card.examples.forEach((example, index) => {
    const at = `examples[${String(index)}]`;
    if (echoesCloze(card.cloze, example)) {
      report("E_EXAMPLE_ECHOES_CLOZE", `${at} is the cloze with its blank filled in.`);
    }
    const missing = missingHeadwordWords(card.headword, example);
    if (missing.length > 0 && missing.length === expected.length) {
      report("E_EXAMPLE_MISSING_ANSWER", `${at} never uses "${card.headword}".`);
    } else if (missing.length > 0) {
      const lost = missing.join(", ");
      report("W_EXAMPLE_PARTIAL_ANSWER", `${at} leaves out ${lost}.`);
    }
    const words = countWords(example);
    if (!reportLength(report, "E_EXAMPLE_TOO_LONG", at, words, MAX_EXAMPLE_WORDS)) {
      reportLength(report, "W_EXAMPLE_LONGISH", at, words, RECOMMENDED_EXAMPLE_WORDS);
    }
  });
}
