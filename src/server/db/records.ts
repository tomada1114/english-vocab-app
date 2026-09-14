import "server-only";

import type { Rating, SchedulerPhase } from "../../core/scheduler";

/**
 * The four scheduling values a `review_log` row keeps on both sides of a rating.
 *
 * @remarks
 * They are stored twice, before and after, rather than derived from the
 * neighbouring rows: the "before" side is the card handed to the scheduler and
 * the "after" side is the card it returned, so a later change to FSRS or to the
 * card file cannot make history disagree with itself.
 *
 * `state` is FSRS's own integer (new, learning, review, relearning) and `due`
 * is epoch milliseconds, like every other timestamp here.
 */
export interface ReviewSnapshot {
  readonly state: SchedulerPhase;
  readonly due: number;
  readonly stability: number;
  readonly difficulty: number;
}

/** One card's whole scheduling state: a `card_state` row without its key. */
export interface SchedulingState extends ReviewSnapshot {
  readonly scheduledDays: number;
  readonly learningSteps: number;
  readonly reps: number;
  readonly lapses: number;
  /** Epoch milliseconds, or `null` for a card whose first rating is in flight. */
  readonly lastReview: number | null;
}

/** One `card_state` row. No row at all means the card has never been reviewed. */
export interface CardState extends SchedulingState {
  readonly cardId: string;
}

/** One `review_log` row: an answer that was given, kept forever. */
export interface ReviewLog {
  readonly id: number;
  readonly cardId: string;
  readonly sessionId: number;
  /** FSRS's rating: 1 again, 2 hard, 3 good, 4 easy. */
  readonly rating: Rating;
  readonly reviewedAt: number;
  readonly before: ReviewSnapshot;
  readonly after: ReviewSnapshot;
}

/**
 * One rating, as the caller hands it over to be stored.
 *
 * @remarks
 * `before` is the card the scheduler was given and `after` the card it
 * returned. Only `after` carries the whole state, because it is what the
 * `card_state` row becomes; the log keeps four values from each side.
 */
export interface ReviewRecord {
  readonly sessionId: number;
  readonly cardId: string;
  readonly rating: Rating;
  readonly reviewedAt: number;
  readonly before: ReviewSnapshot;
  readonly after: SchedulingState;
}

/** The two settings replaced together by the settings endpoint. */
export interface SettingsRecord {
  /** The scope is validated by the caller that owns the scope schema. */
  readonly scope: unknown;
  readonly newCardsPerDay: number;
}

/** One `session` row, with `scope` parsed back out of its JSON column. */
export interface Session {
  readonly id: number;
  readonly startedAt: number;
  /** `null` while the session is still open. */
  readonly endedAt: number | null;
  /**
   * Whatever scope the session ran with, as stored.
   *
   * @remarks
   * `unknown`, because the scope's shape belongs to `src/core/`, not to the
   * store: a caller validates it with its own schema, the way `getSetting`
   * takes one. What this layer promises is that the JSON round-trips.
   */
  readonly scope: unknown;
  readonly newLimit: number;
  readonly rememberedBefore: number;
  /** `null` until the session ends. */
  readonly rememberedAfter: number | null;
}

/** A session about to be opened. */
export interface NewSession {
  readonly startedAt: number;
  readonly scope: unknown;
  readonly newLimit: number;
  readonly rememberedBefore: number;
}

/** What closing a session records against it. */
export interface SessionEnd {
  readonly id: number;
  readonly endedAt: number;
  readonly rememberedAfter: number;
}
