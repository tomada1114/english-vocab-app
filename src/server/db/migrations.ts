import "server-only";

import type { DatabaseSync } from "node:sqlite";

import * as z from "zod";

import { DatabaseError } from "./errors";
import { withTransaction } from "./transaction";

/**
 * Every migration, oldest first; the index of one is its version minus one.
 *
 * @remarks
 * An applied migration is never edited — a file in the wild already ran it, and
 * `PRAGMA user_version` records only how many ran, not which. A change is a new
 * entry appended here.
 *
 * The tables are `STRICT`, so a column declared `INTEGER` cannot quietly hold
 * the string `"3"` or a fractional millisecond: SQLite's usual type affinity
 * would accept both. Every timestamp is an INTEGER of epoch milliseconds (UTC)
 * and every `REAL` holds an FSRS quantity, which is what makes a row readable
 * back as the shape `rows.ts` declares.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE card_state (
    card_id        TEXT    NOT NULL PRIMARY KEY,
    due            INTEGER NOT NULL,
    stability      REAL    NOT NULL,
    difficulty     REAL    NOT NULL,
    scheduled_days INTEGER NOT NULL,
    learning_steps INTEGER NOT NULL,
    reps           INTEGER NOT NULL,
    lapses         INTEGER NOT NULL,
    state          INTEGER NOT NULL,
    last_review    INTEGER
  ) STRICT;

  CREATE TABLE review_log (
    id                INTEGER NOT NULL PRIMARY KEY,
    card_id           TEXT    NOT NULL,
    session_id        INTEGER NOT NULL,
    rating            INTEGER NOT NULL,
    reviewed_at       INTEGER NOT NULL,
    state_before      INTEGER NOT NULL,
    due_before        INTEGER NOT NULL,
    stability_before  REAL    NOT NULL,
    difficulty_before REAL    NOT NULL,
    state_after       INTEGER NOT NULL,
    due_after         INTEGER NOT NULL,
    stability_after   REAL    NOT NULL,
    difficulty_after  REAL    NOT NULL
  ) STRICT;

  CREATE INDEX review_log_card_id_reviewed_at ON review_log (card_id, reviewed_at);

  CREATE TABLE session (
    id                INTEGER NOT NULL PRIMARY KEY,
    started_at        INTEGER NOT NULL,
    ended_at          INTEGER,
    scope             TEXT    NOT NULL,
    new_limit         INTEGER NOT NULL,
    remembered_before REAL    NOT NULL,
    remembered_after  REAL
  ) STRICT;

  CREATE TABLE setting (
    key   TEXT NOT NULL PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;
  `,
];

/** `PRAGMA user_version` as SQLite answers it. */
const userVersionRow = z.object({ user_version: z.int() });

/**
 * Brings `database` up to {@link MIGRATIONS}, applying only what is missing.
 *
 * @remarks
 * The whole batch runs inside one transaction together with the
 * `PRAGMA user_version` that records it, so a file is never left having run
 * half of a migration: either every pending statement applied and the version
 * moved, or nothing did. An already-current file executes no statement at all,
 * which is what makes opening one twice free.
 *
 * `PRAGMA user_version` takes no bound parameter — SQLite parses a pragma
 * argument as a literal — so the count is interpolated. It is the length of a
 * module-level array, never anything a caller supplies.
 *
 * @param database - An open connection, out of a transaction.
 * @returns The version the file is at afterwards.
 * @throws A {@link DatabaseError} coded `ERR_DB_VERSION_AHEAD` when the file
 * was written by a build with more migrations than this one has, or
 * `ERR_DB_MIGRATION` when a pending migration raised.
 */
export function applyMigrations(database: DatabaseSync): number {
  const current = readUserVersion(database);
  if (current > MIGRATIONS.length) {
    throw new DatabaseError(
      "ERR_DB_VERSION_AHEAD",
      `The database is at version ${String(current)}, ahead of the ${String(MIGRATIONS.length)} migrations this build knows. It was written by a newer version of the app.`,
    );
  }
  if (current === MIGRATIONS.length) {
    return current;
  }

  const pending = MIGRATIONS.slice(current);
  try {
    withTransaction(database, () => {
      for (const sql of pending) {
        database.exec(sql);
      }
      database.exec(`PRAGMA user_version = ${String(MIGRATIONS.length)}`);
    });
  } catch (cause) {
    throw new DatabaseError(
      "ERR_DB_MIGRATION",
      `Migration ${String(current + 1)} or a later one failed; the database is unchanged at version ${String(current)}.`,
      { cause },
    );
  }
  return MIGRATIONS.length;
}

/** The migration count `database` records, `0` for a file nothing has touched. */
export function readUserVersion(database: DatabaseSync): number {
  const [row] = database.prepare("PRAGMA user_version").all();
  return userVersionRow.parse(row).user_version;
}
