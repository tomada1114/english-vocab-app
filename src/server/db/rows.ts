import "server-only";

import * as z from "zod";

import type { Rating, SchedulerPhase } from "../../core/scheduler";
import { DatabaseError } from "./errors";
import type { CardState, ReviewLog, Session } from "./records";

// `node:sqlite` hands a row back as `Record<string, SQLOutputValue>` — an
// untyped boundary like a parsed request body, and read by column name rather
// than by a property this file can narrow. Every read below therefore goes
// through a schema, which is also what turns the snake_case columns into the
// camelCase records `records.ts` publishes. The tables are STRICT (see
// `migrations.ts`), so a schema failing here means the file was written by
// something other than this application.

/**
 * SQLite's STRICT INTEGER columns establish integer-ness, not a closed
 * scheduler union. Keep that existing boundary contract; session handling
 * owns the fallback for an integer written by a future or foreign version.
 */
function asSchedulerPhase(value: number): SchedulerPhase {
  return value as SchedulerPhase;
}

function asRating(value: number): Rating {
  return value as Rating;
}

const cardStateRow = z
  .object({
    card_id: z.string(),
    due: z.int(),
    stability: z.number(),
    difficulty: z.number(),
    scheduled_days: z.int(),
    learning_steps: z.int(),
    reps: z.int(),
    lapses: z.int(),
    state: z.int(),
    last_review: z.int().nullable(),
  })
  .transform((row): CardState => ({
    cardId: row.card_id,
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    scheduledDays: row.scheduled_days,
    learningSteps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: asSchedulerPhase(row.state),
    lastReview: row.last_review,
  }));

const reviewLogRow = z
  .object({
    id: z.int(),
    card_id: z.string(),
    session_id: z.int(),
    rating: z.int(),
    reviewed_at: z.int(),
    state_before: z.int(),
    due_before: z.int(),
    stability_before: z.number(),
    difficulty_before: z.number(),
    state_after: z.int(),
    due_after: z.int(),
    stability_after: z.number(),
    difficulty_after: z.number(),
  })
  .transform((row): ReviewLog => ({
    id: row.id,
    cardId: row.card_id,
    sessionId: row.session_id,
    rating: asRating(row.rating),
    reviewedAt: row.reviewed_at,
    before: {
      state: asSchedulerPhase(row.state_before),
      due: row.due_before,
      stability: row.stability_before,
      difficulty: row.difficulty_before,
    },
    after: {
      state: asSchedulerPhase(row.state_after),
      due: row.due_after,
      stability: row.stability_after,
      difficulty: row.difficulty_after,
    },
  }));

const sessionRow = z.object({
  id: z.int(),
  started_at: z.int(),
  ended_at: z.int().nullable(),
  scope: z.string(),
  new_limit: z.int(),
  remembered_before: z.number(),
  remembered_after: z.number().nullable(),
});

const settingRow = z.object({ value: z.string() });
const countRow = z.object({ tally: z.int() });

/** One `card_state` row as the record it stands for. */
export function toCardState(row: unknown): CardState {
  return cardStateRow.parse(row);
}

/** One `review_log` row as the record it stands for. */
export function toReviewLog(row: unknown): ReviewLog {
  return reviewLogRow.parse(row);
}

/** One `session` row, with its `scope` column parsed back out of JSON. */
export function toSession(row: unknown): Session {
  const parsed = sessionRow.parse(row);
  return {
    id: parsed.id,
    startedAt: parsed.started_at,
    endedAt: parsed.ended_at,
    scope: fromJson(parsed.scope, `the scope of session ${String(parsed.id)}`),
    newLimit: parsed.new_limit,
    rememberedBefore: parsed.remembered_before,
    rememberedAfter: parsed.remembered_after,
  };
}

/** The `value` column of one `setting` row, still as JSON text. */
export function toSettingJson(row: unknown): string {
  return settingRow.parse(row).value;
}

/** The single `tally` column a `count(*)` query is written to return. */
export function toTally(row: unknown): number {
  return countRow.parse(row).tally;
}

/**
 * `text` as the value it encodes.
 *
 * @param text - JSON this application wrote into a TEXT column.
 * @param subject - What failed to read back, for the message; never a value.
 * @throws A {@link DatabaseError} coded `ERR_DB_VALUE_CORRUPT`.
 */
export function fromJson(text: string, subject: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new DatabaseError("ERR_DB_VALUE_CORRUPT", `${subject} is not valid JSON.`, {
      cause,
    });
  }
}
