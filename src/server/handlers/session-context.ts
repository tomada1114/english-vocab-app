import "server-only";

import * as z from "zod";

import type { Card } from "../../core/cards/card";
import type { Review } from "../../core/progress";
import { err, ok, type Result } from "../../core/result";
import type { SchedulerPhase, SchedulerState } from "../../core/scheduler";
import { inScope, scopeSchema, type Scope } from "../../core/scope";
import type { Store } from "../db/queries";
import type { CardState, ReviewLog, Session } from "../db/records";
import { sessionFailure } from "./session-errors";

export { sessionFailure, type SessionErrorCode } from "./session-errors";

/**
 * Everything the three study-session handlers are wired with.
 *
 * @remarks
 * The store and the clock are arguments rather than imports so a test drives a
 * handler against `:memory:` and a pinned instant, and so the composition root
 * stays the one file that chooses either. `readCards` is a function rather
 * than an array because the deck is a directory of files a session should see
 * the current state of, not a snapshot taken when the process started.
 */
export interface SessionDependencies {
  readonly store: Store;
  /** Every card in the deck, in-scope or not; the caller filters. */
  readonly readCards: () => Promise<readonly Card[]>;
  /**
   * The card `cardId` names, or `undefined` when the deck does not hold it.
   *
   * @remarks
   * Reads one file rather than the whole deck, which is what keeps rating a
   * card that already has state off the full-deck read `readCards` is.
   */
  readonly readCard: (cardId: string) => Promise<Card | undefined>;
  /** Epoch milliseconds, as `Date.now` reports them. */
  readonly now: () => number;
}

/** The scope a session runs with while the owner has chosen none. */
export const DEFAULT_SCOPE: Scope = { purpose: "ielts", topics: [], target: null };

/** How many new cards a day introduces while the owner has chosen no number. */
export const DEFAULT_NEW_CARDS_PER_DAY = 10;

/** The stored `newCardsPerDay` setting: a count, never negative or fractional. */
const newCardsPerDaySchema = z.int().nonnegative();

/**
 * The session id in `/api/sessions/<id>/reviews` and `/api/sessions/<id>/end`.
 *
 * @remarks
 * Read off the request's own URL rather than taken as a second argument from
 * the route file, which is what keeps every handler here a plain
 * `(request: Request) => Promise<Response>` and every route file a one-line
 * re-export — see `building-app-routes`. Empty segments are dropped first, so
 * a trailing slash names the same session rather than none.
 */
export function sessionIdFrom(request: Request): number | null {
  const segments = new URL(request.url).pathname
    .split("/")
    .filter((segment) => segment !== "");
  return parseSessionId(segments.at(-2) ?? "");
}

/**
 * `raw` as a session id, or `null` when it names none.
 *
 * @remarks
 * The one place this shape is decided, so {@link sessionIdFrom} (a request's
 * path segment) and the summary page (a route's `id` param) cannot silently
 * disagree on what counts as a valid id.
 */
export function parseSessionId(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

/** The session the request's path names, or the answer to refuse it with. */
export function findSession(store: Store, request: Request): Result<Session, Response> {
  const id = sessionIdFrom(request);
  const session = id === null ? undefined : store.getSession(id);
  return session === undefined
    ? err(sessionFailure("ERR_SESSION_NOT_FOUND"))
    : ok(session);
}

/** The scope the owner selected, or {@link DEFAULT_SCOPE} while they have not. */
export function readScope(store: Store): Scope {
  return store.getSetting("scope", scopeSchema) ?? DEFAULT_SCOPE;
}

/** The daily new-card limit, or {@link DEFAULT_NEW_CARDS_PER_DAY}. */
export function readNewCardsPerDay(store: Store): number {
  return (
    store.getSetting("newCardsPerDay", newCardsPerDaySchema) ??
    DEFAULT_NEW_CARDS_PER_DAY
  );
}

/** The ids of the cards `scope` selects, by the predicate every figure uses. */
export function scopedCardIds(cards: readonly Card[], scope: Scope): string[] {
  return cards.filter((card) => inScope(card, scope)).map((card) => card.id);
}

/** Maps stored state to the scheduler's closed union; out-of-range values are corrupt. */
function toPhase(state: number): SchedulerPhase | null {
  return state === 0 || state === 1 || state === 2 || state === 3 ? state : null;
}

/** One `card_state` row as the scheduler and the queue builder read it. */
function toSchedulerState(row: CardState): SchedulerState | null {
  const phase = toPhase(row.state);
  if (phase === null) {
    return null;
  }
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    scheduledDays: row.scheduledDays,
    learningSteps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: phase,
    lastReview: row.lastReview,
  };
}

/** Every row read as a scheduler state, keyed by card id; the corrupt-phase rule. */
function statesFrom(
  rows: readonly CardState[],
): Result<ReadonlyMap<string, SchedulerState>, Response> {
  const states = new Map<string, SchedulerState>();
  for (const row of rows) {
    const state = toSchedulerState(row);
    if (state === null) {
      return err(sessionFailure("ERR_SESSION_CARD_STATE_CORRUPT"));
    }
    states.set(row.cardId, state);
  }
  return ok(states);
}

/** Every rated card's scheduler state, keyed by id; a card with no entry is new. */
export function schedulerStates(
  store: Store,
): Result<ReadonlyMap<string, SchedulerState>, Response> {
  return statesFrom(store.getCardStates());
}

/** One card's scheduler state, `null` when it is new, or the refusal. */
export function schedulerStateOf(
  store: Store,
  cardId: string,
): Result<SchedulerState | null, Response> {
  const row = store.getCardState(cardId);
  if (row === undefined) {
    return ok(null);
  }
  const state = toSchedulerState(row);
  return state === null
    ? err(sessionFailure("ERR_SESSION_CARD_STATE_CORRUPT"))
    : ok(state);
}

/** The scheduler states of the named cards, keyed by id. */
export function schedulerStatesFor(
  store: Store,
  cardIds: readonly string[],
): Result<ReadonlyMap<string, SchedulerState>, Response> {
  return statesFrom(store.getCardStatesFor(cardIds));
}

/** The whole `review_log`, as the narrower view every progress figure reads. */
export function reviewsOf(logs: readonly ReviewLog[]): readonly Review[] {
  return logs.map((log) => ({
    cardId: log.cardId,
    reviewedAt: log.reviewedAt,
    stabilityAfter: log.after.stability,
  }));
}
