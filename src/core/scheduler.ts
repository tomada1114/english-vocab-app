import {
  createEmptyCard,
  forgetting_curve,
  fsrs,
  type Card,
  type CardInput,
} from "ts-fsrs";

/**
 * How well a card was recalled: 1 Again, 2 Hard, 3 Good, 4 Easy — ts-fsrs's
 * own grades, kept as plain numbers so a rating in flight and one already in
 * `review_log` are the same value. Its 0 ("Manual") is deliberately absent.
 */
export type Rating = 1 | 2 | 3 | 4;

/** Where a card sits in the FSRS lifecycle: 0 New, 1 Learning, 2 Review, 3 Relearning. */
export type SchedulerPhase = 0 | 1 | 2 | 3;

/**
 * Everything the scheduler knows about one card: ts-fsrs's `Card` and the
 * `card_state` table field for field, every instant an epoch-millisecond
 * number rather than a `Date`, so no ts-fsrs type reaches a caller and the
 * library stays swappable behind this module. `lastReview` is null exactly
 * while the card has never been rated.
 */
export interface SchedulerState {
  readonly due: number;
  readonly stability: number;
  readonly difficulty: number;
  readonly scheduledDays: number;
  readonly learningSteps: number;
  readonly reps: number;
  readonly lapses: number;
  readonly state: SchedulerPhase;
  readonly lastReview: number | null;
}

/** The state a rating was applied to, and the state it produced. */
export interface RatingOutcome {
  readonly before: SchedulerState;
  readonly after: SchedulerState;
}

/** One study day, as epoch ms: `start` inclusive, `end` exclusive. */
export interface DayBounds {
  readonly start: number;
  readonly end: number;
}

/**
 * The one FSRS instance every rating goes through, carrying the three
 * parameters `building-the-vocab-app` settles. The weights, the learning steps
 * (1m, 10m) and the relearning step (10m) stay at ts-fsrs's defaults, so this
 * names no number the library already owns.
 */
const scheduler = fsrs({
  request_retention: 0.9,
  enable_fuzz: true,
  enable_short_term: true,
});

const MS_PER_DAY = 86_400_000;

/** The local hour a study day begins, as in Anki. */
const ROLLOVER_HOUR = 4;

function toState(card: Card): SchedulerState {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review?.getTime() ?? null,
  };
}

function toCard(state: SchedulerState): CardInput {
  return {
    due: state.due,
    stability: state.stability,
    difficulty: state.difficulty,
    // Deprecated in ts-fsrs, and recomputed from `last_review` on every review.
    elapsed_days: 0,
    scheduled_days: state.scheduledDays,
    learning_steps: state.learningSteps,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    last_review: state.lastReview,
  };
}

/**
 * Applies one rating at `nowMs` — to `state`, or to a brand-new card when it
 * is null — and reports both sides, so a caller persists what went in and what
 * came out without asking the library what it changed. Fuzz is on but seeded
 * from the card and the review time, so the same call always answers the same.
 */
export function rate(
  state: SchedulerState | null,
  rating: Rating,
  nowMs: number,
): RatingOutcome {
  const before = state ?? toState(createEmptyCard(nowMs));
  const { card } = scheduler.next(toCard(before), nowMs, rating);
  return { before, after: toState(card) };
}

/**
 * The probability of recalling a card at `atMs`, in (0, 1]: ts-fsrs's
 * forgetting curve, read with the weights {@link scheduler} itself uses. It is
 * 1 at the review and 0.9 one stability later — what stability means. A time
 * before the review is clamped to the review.
 */
export function retrievability(
  stability: number,
  lastReviewMs: number,
  atMs: number,
): number {
  const elapsedDays = Math.max(0, (atMs - lastReviewMs) / MS_PER_DAY);
  return forgetting_curve(scheduler.parameters.w, elapsedDays, stability);
}

const WALL_CLOCK_PARTS = {
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
} as const satisfies Intl.DateTimeFormatOptions;

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * What `timeZone`'s wall clock reads at `ms`, as the epoch ms that reading
 * would name if it were UTC. `h23` above keeps midnight at hour 0, not 24.
 */
function wallClockOf(ms: number, timeZone: string): number {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, ...WALL_CLOCK_PARTS });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(ms);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
}

/**
 * The instant at which `timeZone`'s wall clock reads `wall`. Two passes,
 * because the offset to subtract is the one in force at the answer rather than
 * at the guess. 04:00 is never a reading a DST change skips or repeats, so
 * exactly one instant satisfies this.
 */
function instantOf(wall: number, timeZone: string): number {
  const offset = (ms: number): number => wallClockOf(ms, timeZone) - ms;
  const guess = wall - offset(wall);
  return wall - offset(guess);
}

/**
 * The study day `nowMs` falls in, running from one 04:00 local to the next.
 * 04:00 rather than midnight, as in Anki: a review at 01:00 belongs to the day
 * the owner is still awake in. A day is 23 or 25 hours long across a DST
 * change, so both ends are read off the wall clock, not one from the other.
 *
 * @param timeZone - An IANA zone name; the process's own zone by default.
 */
export function dayBounds(
  nowMs: number,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): DayBounds {
  const wall = new Date(wallClockOf(nowMs, timeZone));
  const day = wall.getUTCDate() - (wall.getUTCHours() < ROLLOVER_HOUR ? 1 : 0);
  const year = wall.getUTCFullYear();
  const month = wall.getUTCMonth();
  return {
    start: instantOf(Date.UTC(year, month, day, ROLLOVER_HOUR), timeZone),
    end: instantOf(Date.UTC(year, month, day + 1, ROLLOVER_HOUR), timeZone),
  };
}
