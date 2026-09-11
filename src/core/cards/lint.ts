import { cardId, type Card, type Purpose } from "./card";
import { checkExamples, checkFields, checkFront } from "./lint-content";
import { severityOf, type LintFinding, type Report } from "./lint-finding";

export { LINT_RULES } from "./lint-finding";
export type { LintFinding, LintRule, LintSeverity } from "./lint-finding";

/** One card to lint, beside the file name it was read from. */
export interface CardFile {
  /** The file's name, `<id>.json`, not a path. */
  readonly fileName: string;
  readonly card: Card;
}

/**
 * The committed lists a card's tags have to be drawn from.
 *
 * @remarks
 * Stated here rather than imported from the loader that reads them: `core`
 * names no zone above it, and this is the part of those lists a rule needs.
 */
export interface LintLists {
  readonly topics: readonly string[];
  readonly purposes: readonly Purpose[];
}

/**
 * Every rule violation `entries` holds, in file order.
 *
 * @remarks
 * The cards are already through the zod schema, so `E_SCHEMA` here is only
 * what the schema cannot see: a field that is whitespace rather than text. A
 * file that failed the schema outright never became an entry, and whoever read
 * it reports that failure themselves.
 *
 * @param entries - The cards of one directory, each with its file name.
 * @param lists - The committed topic and purpose lists to check tags against.
 */
export function lintCards(
  entries: readonly CardFile[],
  lists: LintLists,
): LintFinding[] {
  const findings: LintFinding[] = [];
  const keys = new Map<string, string>();
  const topics = new Set(lists.topics);
  const purposes = new Set(lists.purposes.map((purpose) => purpose.id));

  for (const { fileName, card } of entries) {
    const report: Report = (rule, message) => {
      findings.push({ severity: severityOf(rule), rule, file: fileName, message });
    };
    checkIdentity(fileName, card, keys, report);
    checkTags(card, topics, purposes, report);
    checkFields(card, report);
    checkFront(card, report);
    checkExamples(card, report);
  }
  return findings;
}

/**
 * The id, the file name and the key this card claims.
 *
 * @remarks
 * `keys` carries the first file seen for each key, so a duplicate is reported
 * against the later file rather than against both. A retired card keeps its
 * key: that is the point of retiring one rather than deleting it.
 */
function checkIdentity(
  fileName: string,
  card: Card,
  keys: Map<string, string>,
  report: Report,
): void {
  const derived = cardId(card.headword, card.pos);
  if (card.id !== derived) {
    report("E_ID_MISMATCH", `id should be "${derived}", which its key derives.`);
  }
  if (fileName !== `${card.id}.json`) {
    report("E_ID_MISMATCH", `the file name should be "${card.id}.json".`);
  }
  const first = keys.get(derived);
  if (first === undefined) {
    keys.set(derived, fileName);
  } else {
    report("E_DUPLICATE_KEY", `"${derived}" is the key ${first} already carries.`);
  }
}

/** Membership of the two committed lists, which the schema does not check. */
function checkTags(
  card: Card,
  topics: ReadonlySet<string>,
  purposes: ReadonlySet<string>,
  report: Report,
): void {
  for (const topic of card.topics) {
    if (!topics.has(topic)) {
      report("E_UNKNOWN_TOPIC", `topic "${topic}" is not in data/topics.json.`);
    }
  }
  for (const purpose of card.purposes) {
    if (!purposes.has(purpose)) {
      report("E_UNKNOWN_PURPOSE", `purpose "${purpose}" is not in data/purposes.json.`);
    }
  }
}
