import "server-only";

import type { DatabaseSync, StatementSync } from "node:sqlite";

/**
 * Every statement `createStore` runs, prepared once against one connection.
 *
 * @remarks
 * Split out of `db/queries.ts`, which was at the 200-line `src/size-budget`
 * ceiling: this is a pure move of the SQL text and the `prepare` calls, with
 * no change to a statement already here. `createStore` reads a field of this
 * instead of a local it closed over.
 */
export interface Statements {
  readonly selectCardStates: StatementSync;
  readonly selectCardState: StatementSync;
  readonly selectCardStatesFor: StatementSync;
  readonly upsertCardState: StatementSync;
  readonly insertReviewLog: StatementSync;
  readonly selectReviewLogs: StatementSync;
  readonly selectReviewLogsForCards: StatementSync;
  readonly countFirstReviews: StatementSync;
  readonly countSessionReviews: StatementSync;
  readonly insertSession: StatementSync;
  readonly updateSessionEnd: StatementSync;
  readonly selectSession: StatementSync;
  readonly selectSetting: StatementSync;
  readonly upsertSetting: StatementSync;
}

/**
 * Prepares every statement `Store` runs, once, against `database`.
 *
 * @remarks
 * The two `json_each(:ids)` queries bind their id list as one JSON-text
 * parameter rather than as a variable number of placeholders, which is what
 * lets them be prepared here exactly once like every other statement: a
 * variable-arity `IN (?,?,…)` would have to be built, and re-prepared, on
 * every call. `json_each('[]')` yields zero rows, so an empty id list needs no
 * special SQL — `Store`'s own guard against it is an optimization, not a
 * correctness requirement.
 */
export function prepareStatements(database: DatabaseSync): Statements {
  return {
    selectCardStates: database.prepare("SELECT * FROM card_state ORDER BY card_id"),

    selectCardState: database.prepare(
      "SELECT * FROM card_state WHERE card_id = :card_id",
    ),

    selectCardStatesFor: database.prepare(`
      SELECT * FROM card_state
      WHERE card_id IN (SELECT value FROM json_each(:ids))
      ORDER BY card_id
    `),

    upsertCardState: database.prepare(`
      INSERT INTO card_state (card_id, due, stability, difficulty, scheduled_days,
                              learning_steps, reps, lapses, state, last_review)
      VALUES (:card_id, :due, :stability, :difficulty, :scheduled_days,
              :learning_steps, :reps, :lapses, :state, :last_review)
      ON CONFLICT (card_id) DO UPDATE SET
        due = excluded.due, stability = excluded.stability,
        difficulty = excluded.difficulty, scheduled_days = excluded.scheduled_days,
        learning_steps = excluded.learning_steps, reps = excluded.reps,
        lapses = excluded.lapses, state = excluded.state,
        last_review = excluded.last_review
    `),

    insertReviewLog: database.prepare(`
      INSERT INTO review_log (card_id, session_id, rating, reviewed_at,
                              state_before, due_before, stability_before,
                              difficulty_before, state_after, due_after,
                              stability_after, difficulty_after)
      VALUES (:card_id, :session_id, :rating, :reviewed_at,
              :state_before, :due_before, :stability_before,
              :difficulty_before, :state_after, :due_after,
              :stability_after, :difficulty_after)
    `),

    selectReviewLogs: database.prepare(
      "SELECT * FROM review_log ORDER BY reviewed_at, id",
    ),

    selectReviewLogsForCards: database.prepare(`
      SELECT * FROM review_log
      WHERE card_id IN (SELECT value FROM json_each(:ids))
      ORDER BY reviewed_at, id
    `),

    countFirstReviews: database.prepare(`
      SELECT count(*) AS tally FROM (
        SELECT min(reviewed_at) AS first_reviewed_at FROM review_log GROUP BY card_id
      ) WHERE first_reviewed_at >= :since
    `),

    countSessionReviews: database.prepare(
      "SELECT count(*) AS tally FROM review_log WHERE session_id = :session_id",
    ),

    insertSession: database.prepare(`
      INSERT INTO session (started_at, scope, new_limit, remembered_before)
      VALUES (:started_at, :scope, :new_limit, :remembered_before)
    `),

    updateSessionEnd: database.prepare(`
      UPDATE session SET ended_at = :ended_at, remembered_after = :remembered_after
      WHERE id = :id
    `),

    selectSession: database.prepare("SELECT * FROM session WHERE id = :id"),

    selectSetting: database.prepare("SELECT value FROM setting WHERE key = :key"),

    upsertSetting: database.prepare(`
      INSERT INTO setting (key, value) VALUES (:key, :value)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `),
  };
}
