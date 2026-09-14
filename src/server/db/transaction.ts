import "server-only";

import type { DatabaseSync } from "node:sqlite";

/**
 * `database.isTransaction`, through a call so TypeScript does not narrow one
 * read by an earlier one.
 *
 * @remarks
 * `isTransaction` is `readonly`, and TypeScript's control-flow analysis
 * assumes a readonly property cannot change between two reads in the same
 * function — true for a plain value, false here, since `database.exec(...)`
 * between the reads is exactly what changes it. Reading it through a call
 * breaks that (incorrect) assumption.
 */
function isTransaction(database: DatabaseSync): boolean {
  return database.isTransaction;
}

/**
 * Runs `work` inside one SQLite transaction, rolling back if it raises.
 *
 * @remarks
 * The store's multi-statement writes — applying pending migrations, recording
 * one rating, and replacing settings — are all-or-nothing, and this is the
 * single place that spelling lives so none can drift from the others.
 *
 * Nesting is rejected up front rather than left to fail inside SQLite: a
 * nested `BEGIN` raises with the outer transaction still open, which would
 * otherwise reach this function's own catch and roll back the outer caller's
 * already-committed-looking work along with the inner failure.
 *
 * The rollback is guarded by `isTransaction` rather than issued
 * unconditionally: SQLite ends the transaction itself on some errors, and a
 * `ROLLBACK` with none open raises, which would replace the failure the caller
 * needs to see with a confusing one about transaction state. Reading
 * `isTransaction` is itself guarded, for the same reason: on a connection a
 * driver-fatal error already invalidated, the getter can raise instead of
 * answering `false`, and that would replace `cause` with an unrelated error
 * about the connection's state.
 *
 * @param database - An open connection; nested transactions are not supported.
 * @param work - The statements to run, as one unit.
 * @returns Whatever `work` returned, once the commit succeeded.
 * @throws Whatever `work` raised, or an `Error` if `database` is already
 * inside a transaction.
 */
export function withTransaction<T>(database: DatabaseSync, work: () => T): T {
  if (isTransaction(database)) {
    throw new Error(
      "withTransaction does not support nesting: a transaction is already open.",
    );
  }
  database.exec("BEGIN");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (cause) {
    try {
      if (isTransaction(database)) {
        database.exec("ROLLBACK");
      }
    } catch {
      // The connection's own state cannot be read or acted on; `cause` below
      // is still the failure that matters to the caller.
    }
    throw cause;
  }
}
