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
  SettingsRecord,
} from "./records";
import {
  cardIdsParameter,
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
import { prepareStatements } from "./statements";
import { withTransaction } from "./transaction";

/**
 * Every question and every change this application asks of its database.
 *
 * The surface is deliberately small and closed, and every method is
 * synchronous because `node:sqlite` is.
 */
export interface Store {
  /** Every card that has been rated at least once, in card-id order. */
  getCardStates(): CardState[];
  /** One card's scheduling state, or `undefined` for a card never rated. */
  getCardState(cardId: string): CardState | undefined;
  /**
   * The state of each named card that has one, in card-id order.
   *
   * @remarks
   * One statement, whatever the length of the list. A repeated id yields one
   * row, an unknown id yields none, and an empty list yields `[]` without a
   * round trip.
   */
  getCardStatesFor(cardIds: readonly string[]): CardState[];
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
   * Every rating of the named cards, oldest first — `listReviewLogs`'s order,
   * over a subset of its rows. Empty list, repeated id and unknown id behave
   * as {@link getCardStatesFor}'s.
   */
  listReviewLogsForCards(cardIds: readonly string[]): ReviewLog[];
  /** How many ratings were recorded against one session. */
  countSessionReviews(sessionId: number): number;
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
  /** Replaces the scope and daily new-card limit as one atomic operation. */
  replaceSettings(settings: SettingsRecord): void;
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
  const statements = prepareStatements(database);

  return {
    getCardStates: () => statements.selectCardStates.all().map(toCardState),

    getCardState: (cardId) => {
      const row = statements.selectCardState.get({ card_id: cardId });
      return row === undefined ? undefined : toCardState(row);
    },

    getCardStatesFor: (cardIds) =>
      cardIds.length === 0
        ? []
        : statements.selectCardStatesFor
            .all(cardIdsParameter(cardIds))
            .map(toCardState),

    recordReview: (review) => {
      withTransaction(database, () => {
        statements.upsertCardState.run(
          cardStateParameters(review.cardId, review.after),
        );
        statements.insertReviewLog.run(reviewLogParameters(review));
      });
    },

    createSession: (session) =>
      Number(statements.insertSession.run(sessionParameters(session)).lastInsertRowid),

    endSession: (end) => {
      statements.updateSessionEnd.run({
        id: end.id,
        ended_at: end.endedAt,
        remembered_after: end.rememberedAfter,
      });
    },

    getSession: (id) => {
      const row = statements.selectSession.get({ id });
      return row === undefined ? undefined : toSession(row);
    },

    listReviewLogs: () => statements.selectReviewLogs.all().map(toReviewLog),

    listReviewLogsForCards: (cardIds) =>
      cardIds.length === 0
        ? []
        : statements.selectReviewLogsForCards
            .all(cardIdsParameter(cardIds))
            .map(toReviewLog),

    countSessionReviews: (sessionId) =>
      toTally(statements.countSessionReviews.get({ session_id: sessionId })),

    countFirstReviewsSince: (since) =>
      toTally(statements.countFirstReviews.get({ since })),

    getSetting: <T>(key: string, schema: ZodType<T>): T | undefined => {
      const row = statements.selectSetting.get({ key });
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
      statements.upsertSetting.run({ key, value: toJson(value, `setting "${key}"`) });
    },
    replaceSettings: (settings) => {
      withTransaction(database, () => {
        statements.upsertSetting.run({
          key: "scope",
          value: toJson(settings.scope, 'setting "scope"'),
        });
        statements.upsertSetting.run({
          key: "newCardsPerDay",
          value: toJson(settings.newCardsPerDay, 'setting "newCardsPerDay"'),
        });
      });
    },
  };
}
