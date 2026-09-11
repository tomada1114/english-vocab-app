/**
 * Every number the card Lint compares against, and nothing else.
 *
 * @remarks
 * One module so a threshold is changed in one place and every rule, message
 * and test reads the same value — `src/core/cards/lint.ts` states no number of
 * its own, and a test asserting a limit imports the constant rather than
 * repeating it. The values are the ones
 * `.agents/skills/building-the-vocab-app/references/card-data.md` settles,
 * carried over from the reference validator this Lint is ported from.
 */

/**
 * The most words a front may hold, counting `definition` and `cloze` together.
 *
 * @remarks
 * The front is a definition, not an explanation: past this the reader is
 * reading rather than recalling.
 */
export const MAX_FRONT_WORDS = 40;

/** The most words the `cloze` sentence alone may hold. */
export const MAX_CLOZE_WORDS = 20;

/**
 * The most words a `headword` may hold.
 *
 * @remarks
 * One word in v1; the ceiling is what a later phrase card is allowed to grow
 * to, and anything longer is a sentence rather than an answer.
 */
export const MAX_HEADWORD_WORDS = 5;

/** The most words one example sentence may hold before it is an ERROR. */
export const MAX_EXAMPLE_WORDS = 12;

/**
 * The length past which an example is reported as a WARN rather than blocked.
 *
 * @remarks
 * A short example is read at a glance. This one warns instead of failing
 * because the line between "long" and "too long" is a judgment; drop the rule
 * if it turns out to fire on most cards, as `card-data.md` says.
 */
export const RECOMMENDED_EXAMPLE_WORDS = 8;

/**
 * The shortest cloze fragment the echo rule will compare against an example.
 *
 * @remarks
 * Measured in normalized characters (lowercase letters and digits, spaces and
 * punctuation dropped). A shorter fragment — `I ` or `We ` — turns up by
 * coincidence in a perfectly good example, so comparing it would report an
 * echo that is not one.
 */
export const ECHO_MIN_FRAGMENT_LEN = 8;
