import * as z from "zod";

import { LEVELS, type Card, type Level } from "./cards/card";

/**
 * A tag id, as a scope names one.
 *
 * @remarks
 * Membership of the committed `data/purposes.json` and `data/topics.json`
 * lists is deliberately not checked here, for the reason `cardSchema` gives:
 * this schema answers "is this the shape of a scope", and whether a tag exists
 * is the Lint's question.
 */
const tagId = z.string().min(1);

/**
 * The IELTS band scores the UI offers: 4.0 to 9.0 in half-band steps.
 *
 * @remarks
 * Closed on purpose — {@link IELTS_CEFR} has to answer for every one of them,
 * and a band outside this range has no published CEFR comparison to read.
 */
export const IELTS_SCORES = [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9] as const;

/** One of {@link IELTS_SCORES}. */
export type IeltsScore = (typeof IELTS_SCORES)[number];

/**
 * IELTS band score to CEFR level.
 *
 * @remarks
 * Read off IELTS's own comparison page, which says its boundaries are blurred:
 * 4.0–5.0 → B1, 5.5–6.5 → B2, 7.0–8.0 → C1, 8.5–9.0 → C2. Written out band by
 * band rather than as ranges, so `as const satisfies` fails to compile when a
 * band is added to {@link IELTS_SCORES} and left unmapped, and so no reader has
 * to work out which side of a boundary a band falls on.
 */
export const IELTS_CEFR = {
  4: "B1",
  4.5: "B1",
  5: "B1",
  5.5: "B2",
  6: "B2",
  6.5: "B2",
  7: "C1",
  7.5: "C1",
  8: "C1",
  8.5: "C2",
  9: "C2",
} as const satisfies Record<IeltsScore, Level>;

/** The exam score a scope aims at. Only IELTS has a table here. */
export const targetSchema = z.strictObject({
  exam: z.literal("ielts"),
  score: z.literal(IELTS_SCORES),
});

/** A target that passed {@link targetSchema}. */
export type Target = z.infer<typeof targetSchema>;

/**
 * What the owner selected on the home screen; every number follows it.
 *
 * @remarks
 * Strict, and stored as the `session.scope` JSON of every session, so a key
 * that no longer means anything fails to parse instead of narrowing a scope by
 * a field nothing reads.
 */
export const scopeSchema = z.strictObject({
  /** One purpose id; a card serves it or is out of scope. */
  purpose: tagId,
  /** Topic ids, **empty meaning all** rather than none. */
  topics: z.array(tagId),
  /** `null` when the owner set no target, which is every level. */
  target: targetSchema.nullable(),
});

/** A scope that passed {@link scopeSchema}. */
export type Scope = z.infer<typeof scopeSchema>;

/**
 * The CEFR levels `target` selects: the band's own level and the one below it.
 *
 * @remarks
 * Two levels rather than one because a card at the level below the target is
 * what a reader at the target is expected to already hold — IELTS 7.0 is C1,
 * and the scope it selects is B2 and C1. Easiest first, as {@link LEVELS} is.
 * The lowest level any band maps to is B1, so the slice always has two
 * entries; it is written to survive a table that one day maps A1.
 */
export function targetLevels(target: Target): readonly Level[] {
  const index = LEVELS.indexOf(IELTS_CEFR[target.score]);
  return LEVELS.slice(Math.max(0, index - 1), index + 1);
}

/**
 * Whether `card` is one of the cards `scope` selects.
 *
 * @remarks
 * Four conditions, each of which can rule a card out on its own: a retired
 * card is in no scope at all, the card's `purposes` must include the scope's
 * purpose, a non-empty `topics` must overlap the card's topics, and a target
 * must name the card's level.
 */
export function inScope(card: Card, scope: Scope): boolean {
  if (card.retired === true || !card.purposes.includes(scope.purpose)) {
    return false;
  }
  const topicMatches =
    scope.topics.length === 0 || scope.topics.some((id) => card.topics.includes(id));
  return (
    topicMatches &&
    (scope.target === null || targetLevels(scope.target).includes(card.level))
  );
}
