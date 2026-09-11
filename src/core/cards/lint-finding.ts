/**
 * What the card Lint reports, and under which names.
 *
 * @remarks
 * The vocabulary is its own module so `lint.ts` is the rules and this is the
 * shape they are reported in: a reader answering "what can the Lint say?" opens
 * one short file, and a caller that only renders findings imports no rule.
 */

/**
 * Every rule the Lint reports, as the table in
 * `.agents/skills/building-the-vocab-app/references/card-data.md` states them.
 *
 * @remarks
 * A closed list rather than `string`: this is what a report groups by and what
 * a test names, so a renamed rule fails to compile rather than quietly
 * reporting under a name nothing watches for. Written as a value as well as a
 * type because the table in that reference is the contract — a test reads the
 * table and this list and fails when they disagree. An `E_` rule blocks and a
 * `W_` rule passes, which is where {@link severityOf} reads a finding's
 * severity from: one id, never a severity beside it that could disagree.
 */
export const LINT_RULES = [
  "E_SCHEMA",
  "E_ID_MISMATCH",
  "E_DUPLICATE_KEY",
  "E_UNKNOWN_TOPIC",
  "E_UNKNOWN_PURPOSE",
  "E_FORBIDDEN_MARK",
  "E_HAS_CJK",
  "E_CLOZE_BLANK",
  "E_ANSWER_LEAK",
  "E_EXAMPLE_MISSING_ANSWER",
  "E_EXAMPLE_ECHOES_CLOZE",
  "E_EXAMPLES_IDENTICAL",
  "E_FRONT_TOO_LONG",
  "E_CLOZE_TOO_LONG",
  "E_HEADWORD_TOO_LONG",
  "E_EXAMPLE_TOO_LONG",
  "W_EXAMPLE_PARTIAL_ANSWER",
  "W_EXAMPLE_LONGISH",
] as const;

/** One of {@link LINT_RULES}. */
export type LintRule = (typeof LINT_RULES)[number];

/** `ERROR` fails a run; `WARN` is reported and passes. */
export type LintSeverity = "ERROR" | "WARN";

/**
 * One thing the Lint has to say about one file.
 *
 * @remarks
 * Plain data, never an exception: one bad card must not hide the hundreds
 * beside it, and what a WARN is worth is the caller's decision. `message` is
 * prose for a reader and is not a contract — `rule` is what anything branches
 * on.
 */
export interface LintFinding {
  readonly severity: LintSeverity;
  readonly rule: LintRule;
  /** The card file the finding is about, named as the caller named it. */
  readonly file: string;
  readonly message: string;
}

/** Records one finding against the file a rule is reading. */
export type Report = (rule: LintRule, message: string) => void;

/** Whether `rule` blocks a run or only reports, read off its prefix. */
export function severityOf(rule: LintRule): LintSeverity {
  return rule.startsWith("W_") ? "WARN" : "ERROR";
}
