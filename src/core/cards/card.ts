import * as z from "zod";

/**
 * The parts of speech a card may carry.
 *
 * @remarks
 * Closed on purpose: the key of a card is `(headword, pos)`, so a value added
 * here changes which cards can coexist. Phrase kinds are added when phrases
 * arrive — see `building-the-vocab-app`.
 */
export const POS_VALUES = ["noun", "verb", "adjective", "adverb"] as const;

/** One of {@link POS_VALUES}. */
export type Pos = (typeof POS_VALUES)[number];

/** The CEFR levels a card may declare, easiest first. */
export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/** One of {@link LEVELS}. */
export type Level = (typeof LEVELS)[number];

/**
 * A string field that carries text rather than the absence of it.
 *
 * @remarks
 * Every text field of a card is required, so an empty one is a card whose
 * front or back would render blank. Whitespace-only text and every other
 * content rule belong to the Lint, not here.
 */
const nonEmptyString = z.string().min(1);

/**
 * One vocabulary card, as one file under `data/cards/<id>.json`.
 *
 * @remarks
 * Strict: an unknown key is an error rather than a field silently ignored,
 * because a misspelled `topics` would otherwise leave a card untagged with
 * nothing reporting it.
 *
 * Membership of `purposes` and `topics` in the committed lists is deliberately
 * not checked here. The schema answers "is this the shape of a card"; whether
 * a tag exists, and every rule about the text itself, is the Lint's question.
 */
export const cardSchema = z.strictObject({
  /** Equals `cardId(headword, pos)` and the file name without `.json`. */
  id: nonEmptyString,
  /** The answer, shown on the back. */
  headword: nonEmptyString,
  pos: z.enum(POS_VALUES),
  level: z.enum(LEVELS),
  /** Ids from `data/purposes.json`; a card serves at least one. */
  purposes: z.array(nonEmptyString).min(1),
  /** Ids from `data/topics.json`; a card carries at least one. */
  topics: z.array(nonEmptyString).min(1),
  /** English, shown on the front. */
  definition: nonEmptyString,
  /** A sentence with the answer blanked as `___`, shown on the front. */
  cloze: nonEmptyString,
  /** Exactly two, shown on the back with the headword. */
  examples: z.tuple([nonEmptyString, nonEmptyString]),
  /** Absent means active. A retired card leaves every session and count. */
  retired: z.literal(true).optional(),
});

/** A card that passed {@link cardSchema}. */
export type Card = z.infer<typeof cardSchema>;

/** `data/topics.json`: the fixed topic ids, in the order they are offered. */
export const topicsSchema = z.array(nonEmptyString).min(1);

/** `data/purposes.json`: each purpose's id and the label a reader sees. */
export const purposesSchema = z
  .array(z.strictObject({ id: nonEmptyString, label: nonEmptyString }))
  .min(1);

/** One entry of `data/purposes.json`. */
export type Purpose = z.infer<typeof purposesSchema>[number];

/**
 * The id a card with this key gets, which is also its file name.
 *
 * @remarks
 * Derived rather than authored, so two cards with the same key cannot be given
 * different ids and quietly coexist. `("carbon footprint", "noun")` is
 * `carbon-footprint--noun`; the doubled separator keeps a hyphenated headword
 * (`well-being`) readable against the part of speech.
 */
export function cardId(headword: string, pos: Pos): string {
  return `${slug(headword)}--${pos}`;
}

/**
 * `value` lowercased, with every run of characters outside `[a-z0-9]`
 * collapsed into one `-` and no `-` left at either end.
 *
 * @remarks
 * Not exported: the id is the contract, and a caller that needed the slug
 * alone would be deriving a second identifier from the same key.
 */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
