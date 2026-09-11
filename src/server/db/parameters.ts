import "server-only";

import type { SQLInputValue } from "node:sqlite";

import { DatabaseError } from "./errors";
import type { NewSession, ReviewRecord, SchedulingState } from "./records";

// The write half of the translation `rows.ts` does for reads: one record in,
// the named parameters one statement binds out. Each builder names every
// column its statement takes, so a column added in a migration fails to
// compile here rather than binding to nothing at run time.

/**
 * `value` as the JSON a TEXT column stores.
 *
 * @param value - Anything with a JSON form; `scope`, or a setting's value.
 * @param subject - What is being stored, for the message; never the value.
 * @throws A {@link DatabaseError} coded `ERR_DB_VALUE_INVALID` when `value` has
 * no JSON form at all — `undefined`, a function, a symbol — which
 * `JSON.stringify` reports by returning nothing rather than by raising.
 */
export function toJson(value: unknown, subject: string): string {
  // The standard library types `stringify` as returning `string`, which is
  // untrue for exactly the values this guards against. Widening it back is
  // what keeps the check below from being reported as dead code.
  const text = JSON.stringify(value) as string | undefined;
  if (text === undefined) {
    throw new DatabaseError(
      "ERR_DB_VALUE_INVALID",
      `${subject} has no JSON representation and cannot be stored.`,
    );
  }
  return text;
}

/** A `card_state` row's named parameters, for the insert and the update alike. */
export function cardStateParameters(
  cardId: string,
  state: SchedulingState,
): Record<string, SQLInputValue> {
  return {
    card_id: cardId,
    due: state.due,
    stability: state.stability,
    difficulty: state.difficulty,
    scheduled_days: state.scheduledDays,
    learning_steps: state.learningSteps,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    last_review: state.lastReview,
  };
}

/** A `review_log` row's named parameters. */
export function reviewLogParameters(
  review: ReviewRecord,
): Record<string, SQLInputValue> {
  return {
    card_id: review.cardId,
    session_id: review.sessionId,
    rating: review.rating,
    reviewed_at: review.reviewedAt,
    state_before: review.before.state,
    due_before: review.before.due,
    stability_before: review.before.stability,
    difficulty_before: review.before.difficulty,
    state_after: review.after.state,
    due_after: review.after.due,
    stability_after: review.after.stability,
    difficulty_after: review.after.difficulty,
  };
}

/** A `session` row's named parameters, for a session about to be opened. */
export function sessionParameters(session: NewSession): Record<string, SQLInputValue> {
  return {
    started_at: session.startedAt,
    scope: toJson(session.scope, "the scope of a new session"),
    new_limit: session.newLimit,
    remembered_before: session.rememberedBefore,
  };
}
