import "server-only";

import type { DatabaseSync } from "node:sqlite";

import type { ZodType } from "zod";

import { DatabaseError } from "./errors";
import type {
  CardState,
  NewSession,
  ReviewLog,
  ReviewRecord,
  Session,
  SessionEnd,
} from "./records";
import {
  cardStateParameters,
  reviewLogParameters,
  sessionParameters,
  toJson,
} from "./parameters";
import {
  fromJson,
  toCardState,
  toReviewLog,
  toSession,
  toSettingJson,
  toTally,
} from "./rows";
import { withTransaction } from "./transaction";

/**
 * Every question and every change this application asks of its database.
 *
 * @remarks
 * The surface is deliberately small and closed: a caller reaches the store
 * through one of these, never by preparing SQL of its own, so the tables stay
 * something `migrations.ts` can change without hunting for query strings.
 *
 * Every method is synchronous, because `node:sqlite` is: the calls run against
 * a local file with no network in front of them, and wrapping them in promises
 * would only claim a concurrency the driver does not have.
 */
export interface Store {
  /** Every card that has been rated at least once, in card-id order. */
  getCardStates(): CardState[];
  /**
   * Records one rating: the card's new state and the log row, or neither.
   *
   * @throws Whatever SQLite raises if either statement is rejected, after the
   * transaction has been rolled back.
   */
  recordReview(review: ReviewRecord): void;
  /** Opens a session and returns the id the rest of it is recorded against. */
  createSession(session: NewSession): number;
  /** Closes a session. A session that is not there is left alone. */
  endSession(end: SessionEnd): void;
  getSession(id: number): Session | undefined;
  /** Every rating ever given, oldest first. The table is append-only. */
  listReviewLogs(): ReviewLog[];
  /**
   * How many distinct cards were rated for the first time at or after `since`.
   *
   * @remarks
   * This is what the daily new-card limit is counted against — per day, as in
   * Anki, rather than per session.
   */
  countFirstReviewsSince(since: number): number;
  /**
   * The stored setting, or `undefined` when the key was never set.
   *
   * @throws A {@link DatabaseError} coded `ERR_DB_VALUE_CORRUPT` when the
   * stored text is not valid JSON, or `ERR_DB_VALUE_SCHEMA_MISMATCH` when it
   * parses but does not match `schema`.
   */
  getSetting<T>(key: string, schema: ZodType<T>): T | undefined;
  /** Stores `value` as JSON, replacing whatever the key held. */
  setSetting(key: string, value: unknown): void;
}

/**
 * Binds the query surface to one open, migrated connection.
 *
 * @remarks
 * Every statement is prepared once here rather than on each call, which is why
 * this is a factory over a connection instead of a module of free functions.
 * The connection stays the caller's to close; this adds no ownership of it.
 *
 * @param database - A connection `openDatabase` has already migrated.
 */
export function createStore(database: DatabaseSync): Store {
  const selectCardStates = database.prepare(
    "SELECT * FROM card_state ORDER BY card_id",
  );
  const upsertCardState = database.prepare(`
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
  `);
  const insertReviewLog = database.prepare(`
    INSERT INTO review_log (card_id, session_id, rating, reviewed_at,
                            state_before, due_before, stability_before,
                            difficulty_before, state_after, due_after,
                            stability_after, difficulty_after)
    VALUES (:card_id, :session_id, :rating, :reviewed_at,
            :state_before, :due_before, :stability_before,
            :difficulty_before, :state_after, :due_after,
            :stability_after, :difficulty_after)
  `);
  const selectReviewLogs = database.prepare(
    "SELECT * FROM review_log ORDER BY reviewed_at, id",
  );
  const countFirstReviews = database.prepare(`
    SELECT count(*) AS tally FROM (
      SELECT min(reviewed_at) AS first_reviewed_at FROM review_log GROUP BY card_id
    ) WHERE first_reviewed_at >= :since
  `);
  const insertSession = database.prepare(`
    INSERT INTO session (started_at, scope, new_limit, remembered_before)
    VALUES (:started_at, :scope, :new_limit, :remembered_before)
  `);
  const updateSessionEnd = database.prepare(`
    UPDATE session SET ended_at = :ended_at, remembered_after = :remembered_after
    WHERE id = :id
  `);
  const selectSession = database.prepare("SELECT * FROM session WHERE id = :id");
  const selectSetting = database.prepare("SELECT value FROM setting WHERE key = :key");
  const upsertSetting = database.prepare(`
    INSERT INTO setting (key, value) VALUES (:key, :value)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `);

  return {
    getCardStates: () => selectCardStates.all().map(toCardState),

    recordReview: (review) => {
      withTransaction(database, () => {
        upsertCardState.run(cardStateParameters(review.cardId, review.after));
        insertReviewLog.run(reviewLogParameters(review));
      });
    },

    createSession: (session) =>
      Number(insertSession.run(sessionParameters(session)).lastInsertRowid),

    endSession: (end) => {
      updateSessionEnd.run({
        id: end.id,
        ended_at: end.endedAt,
        remembered_after: end.rememberedAfter,
      });
    },

    getSession: (id) => {
      const row = selectSession.get({ id });
      return row === undefined ? undefined : toSession(row);
    },

    listReviewLogs: () => selectReviewLogs.all().map(toReviewLog),

    countFirstReviewsSince: (since) => toTally(countFirstReviews.get({ since })),

    getSetting: <T>(key: string, schema: ZodType<T>): T | undefined => {
      const row = selectSetting.get({ key });
      if (row === undefined) {
        return undefined;
      }
      const subject = `the stored value of setting "${key}"`;
      const parsed = schema.safeParse(fromJson(toSettingJson(row), subject));
      if (!parsed.success) {
        throw new DatabaseError(
          "ERR_DB_VALUE_SCHEMA_MISMATCH",
          `${subject} does not match the schema the caller asked for.`,
          { cause: parsed.error },
        );
      }
      return parsed.data;
    },

    setSetting: (key, value) => {
      upsertSetting.run({ key, value: toJson(value, `setting "${key}"`) });
    },
  };
}
