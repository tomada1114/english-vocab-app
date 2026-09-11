import type { Card } from "./cards/card";
import { dayBounds, retrievability } from "./scheduler";
import { inScope, type Scope } from "./scope";

/**
 * One rating, as every figure here reads it.
 *
 * @remarks
 * A deliberately narrower view than the stored `review_log` row: what the
 * forgetting curve needs is the instant a card was rated and the stability
 * that rating produced. Nothing here knows where the rows came from, which is
 * what keeps this module framework- and store-free.
 */
export interface Review {
  readonly cardId: string;
  /** Epoch milliseconds, like every other instant in this app. */
  readonly reviewedAt: number;
  /** The stability the rating produced — `review_log`'s `stability_after`. */
  readonly stabilityAfter: number;
}

/** One point of {@link dailyCurve}: remembered-now as of `atMs`. */
export interface CurvePoint {
  readonly atMs: number;
  readonly remembered: number;
}

/**
 * Everything a progress figure is computed from.
 *
 * @remarks
 * Every number is recomputed from this on each call and never snapshotted, so
 * a scope the owner has never selected before shows the same history as one
 * they have used all along.
 */
export interface ProgressInput {
  readonly cards: readonly Card[];
  /** Every rating ever recorded, in any order; the whole `review_log`. */
  readonly reviews: readonly Review[];
  readonly scope: Scope;
}

/** The ids of the in-scope cards, which is where retired cards drop out. */
function scopedIds(input: ProgressInput): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const card of input.cards) {
    if (inScope(card, input.scope)) {
      ids.add(card.id);
    }
  }
  return ids;
}

/** Σ R over `reviews`, each read as a card's last rating before `atMs`. */
function sumRetrievability(reviews: Iterable<Review>, atMs: number): number {
  let total = 0;
  for (const review of reviews) {
    total += retrievability(review.stabilityAfter, review.reviewedAt, atMs);
  }
  return total;
}

/** Every in-scope rating at or before `untilMs`, oldest first. */
function scopedReviews(input: ProgressInput, untilMs: number): Review[] {
  const ids = scopedIds(input);
  return input.reviews
    .filter((review) => review.reviewedAt <= untilMs && ids.has(review.cardId))
    .sort((left, right) => left.reviewedAt - right.reviewedAt);
}

/**
 * Σ R(card, `nowMs`) over the reviewed, non-retired cards in scope.
 *
 * @remarks
 * R is the FSRS forgetting curve evaluated from each card's last review at or
 * before `nowMs`, so a card rated at that instant contributes 1 and one rated
 * a stability ago contributes 0.9. A card with no review contributes nothing —
 * it is counted by {@link unlearnedCount} instead. The display rounds the sum;
 * this does not.
 */
export function rememberedNow(input: ProgressInput, nowMs: number): number {
  const latest = new Map<string, Review>();
  for (const review of scopedReviews(input, nowMs)) {
    latest.set(review.cardId, review);
  }
  return sumRetrievability(latest.values(), nowMs);
}

/** How many in-scope cards have never been rated. */
export function unlearnedCount(input: ProgressInput): number {
  const reviewed = new Set(input.reviews.map((review) => review.cardId));
  let count = 0;
  for (const card of input.cards) {
    if (inScope(card, input.scope) && !reviewed.has(card.id)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Remembered now over the target scope, divided by the cards in that scope.
 *
 * @remarks
 * `null` rather than a number in the two cases where there is nothing to show:
 * no target was set, and a target whose scope holds no cards at all — 0 would
 * claim a ratio that is not defined. No exam score is ever estimated back out
 * of this.
 */
export function targetRatio(input: ProgressInput, nowMs: number): number | null {
  if (input.scope.target === null) {
    return null;
  }
  const cardsInScope = scopedIds(input).size;
  return cardsInScope === 0 ? null : rememberedNow(input, nowMs) / cardsInScope;
}

/**
 * Remembered now at each study day from the first in-scope review to today.
 *
 * @remarks
 * One point per study day, taken at the 04:00 rollover the day begins at, with
 * today's point taken at `nowMs` instead because the day is still running.
 * That makes the last point equal {@link rememberedNow} at `nowMs`, always.
 * A scope nothing in it has ever been rated under has no first review to start
 * from, so it has no curve: the answer is an empty array rather than a flat
 * line at zero, which would draw a measurement that never happened.
 *
 * The cost is one closed-form curve evaluation per in-scope card per day
 * (3,000 × 365 ≈ 1.1M), which is why the ratings are walked once in time order
 * alongside the days rather than searched per point.
 *
 * @param timeZone - An IANA zone name; the process's own zone by default.
 */
export function dailyCurve(
  input: ProgressInput,
  nowMs: number,
  timeZone?: string,
): readonly CurvePoint[] {
  const reviews = scopedReviews(input, nowMs);
  const first = reviews[0];
  if (first === undefined) {
    return [];
  }

  const latest = new Map<string, Review>();
  let next = 0;
  const upTo = (atMs: number): void => {
    for (let review = reviews[next]; review !== undefined; review = reviews[next]) {
      if (review.reviewedAt > atMs) {
        break;
      }
      latest.set(review.cardId, review);
      next += 1;
    }
  };

  const points: CurvePoint[] = [];
  const today = dayBounds(nowMs, timeZone).start;
  for (
    let day = dayBounds(first.reviewedAt, timeZone);
    day.start < today;
    day = dayBounds(day.end, timeZone)
  ) {
    upTo(day.start);
    points.push({
      atMs: day.start,
      remembered: sumRetrievability(latest.values(), day.start),
    });
  }

  upTo(nowMs);
  points.push({ atMs: nowMs, remembered: sumRetrievability(latest.values(), nowMs) });
  return points;
}
