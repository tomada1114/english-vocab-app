import "server-only";

import * as z from "zod";

import type { Card } from "../../core/cards/card";
import type { Review } from "../../core/progress";
import { err, ok, type Result } from "../../core/result";
import type { SchedulerPhase, SchedulerState } from "../../core/scheduler";
import { scopeSchema, type Scope } from "../../core/scope";
import type { Store } from "../db/queries";
import type { CardState, ReviewLog, Session } from "../db/records";
import { failure } from "../http";

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
 * Every way a study-session request is refused by this layer.
 *
 * @remarks
 * The body-read vocabulary — `ERR_BAD_REQUEST` and `ERR_PAYLOAD_TOO_LARGE` —
 * belongs to `src/server/http.ts` and is answered there; these are the
 * failures that need the session and the deck to be decided at all.
 */
export type SessionErrorCode =
  /** The body is JSON, but not `{ cardId, rating }` with a rating of 1–4. */
  | "ERR_SESSION_REQUEST_INVALID"
  /** The path names no session this database has opened. */
  | "ERR_SESSION_NOT_FOUND"
  /** The rated card id is in no file under the card directory. */
  | "ERR_SESSION_CARD_NOT_FOUND"
  /** The session row's stored scope no longer matches the scope schema. */
  | "ERR_SESSION_SCOPE_CORRUPT"
  /** A stored card state names no scheduler phase. */
  | "ERR_SESSION_CARD_STATE_CORRUPT";

/**
 * The status each code is answered with.
 *
 * @remarks
 * `as const satisfies` rather than an annotation: a code added to the union
 * above fails to compile here until it has been given a status, instead of
 * falling through to a default nobody chose.
 */
const SESSION_ERROR_STATUS = {
  ERR_SESSION_REQUEST_INVALID: 400,
  ERR_SESSION_NOT_FOUND: 404,
  ERR_SESSION_CARD_NOT_FOUND: 400,
  ERR_SESSION_SCOPE_CORRUPT: 500,
  ERR_SESSION_CARD_STATE_CORRUPT: 500,
} as const satisfies Record<SessionErrorCode, number>;

/**
 * One fixed sentence per code.
 *
 * @remarks
 * Each names the shape of what was refused and never the content that was
 * sent: a card id or a rating quoted back here would be copied into every log
 * that records the answer. `designing-errors` holds the rule.
 */
const SESSION_ERROR_MESSAGE = {
  ERR_SESSION_REQUEST_INVALID:
    "The request body must be an object with a card id and a rating of 1, 2, 3 or 4.",
  ERR_SESSION_NOT_FOUND: "The path does not name a session that was ever opened.",
  ERR_SESSION_CARD_NOT_FOUND: "The request names a card the deck does not hold.",
  ERR_SESSION_SCOPE_CORRUPT:
    "The scope stored against that session does not match the scope schema.",
  ERR_SESSION_CARD_STATE_CORRUPT:
    "A card's stored scheduling state does not name a phase the scheduler knows.",
} as const satisfies Record<SessionErrorCode, string>;

/** The answer one of these codes is sent as. */
export function sessionFailure(code: SessionErrorCode): Response {
  return failure(SESSION_ERROR_STATUS[code], code, SESSION_ERROR_MESSAGE[code]);
}

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

/** Every rated card's scheduler state, keyed by id; a card with no entry is new. */
export function schedulerStates(
  store: Store,
): Result<ReadonlyMap<string, SchedulerState>, Response> {
  const states = new Map<string, SchedulerState>();
  for (const row of store.getCardStates()) {
    const state = toSchedulerState(row);
    if (state === null) {
      return err(sessionFailure("ERR_SESSION_CARD_STATE_CORRUPT"));
    }
    states.set(row.cardId, state);
  }
  return ok(states);
}

/** The whole `review_log`, as the narrower view every progress figure reads. */
export function reviewsOf(logs: readonly ReviewLog[]): readonly Review[] {
  return logs.map((log) => ({
    cardId: log.cardId,
    reviewedAt: log.reviewedAt,
    stabilityAfter: log.after.stability,
  }));
}
