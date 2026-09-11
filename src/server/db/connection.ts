import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { applyMigrations } from "./migrations";

/**
 * The name SQLite reserves for a database that never reaches the disk.
 *
 * @remarks
 * Tests open one of these, so it has no directory to create and no journal to
 * put into WAL mode.
 */
const IN_MEMORY = ":memory:";

/**
 * Opens the vocabulary database at `file`, migrated and ready to query.
 *
 * @remarks
 * This is the only place in the application that constructs a `DatabaseSync`,
 * which is what makes "where is the database opened, and with what settings" a
 * question answered by one file. `tests/boundaries.test.ts` holds that to
 * `src/server/db/` from the module graph.
 *
 * Three things happen in a fixed order, and the order is the point. The parent
 * directory is created first, because the default path is `.data/`, which is
 * gitignored and therefore absent in a fresh checkout — without this, the first
 * page load of a new clone fails on a missing directory rather than starting a
 * database. WAL comes next and outside any transaction, since SQLite refuses a
 * journal-mode change inside one; it is what lets a reader (a page rendering
 * progress) run while a writer (a rating being recorded) commits. The
 * migrations come last, so a connection handed back is one whose tables exist.
 *
 * It throws rather than returning a `Result`, for the reason `src/server/env.ts`
 * gives: a database that cannot be opened or migrated is a deployment fault
 * with no caller-side recovery. A connection that got as far as being
 * constructed is closed before the failure is rethrown, so a failed open leaks
 * no handle.
 *
 * @param file - A filesystem path, or `":memory:"` for a throwaway database.
 * @returns An open, migrated connection the caller owns and closes.
 * @throws A `DatabaseError` when the migrations could not be applied, or
 * whatever `node:sqlite` raises when the file itself cannot be opened.
 */
export function openDatabase(file: string): DatabaseSync {
  if (file !== IN_MEMORY) {
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }

  const database = new DatabaseSync(file);
  try {
    database.exec("PRAGMA journal_mode = WAL");
    applyMigrations(database);
  } catch (cause) {
    database.close();
    throw cause;
  }
  return database;
}
