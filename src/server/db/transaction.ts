import "server-only";

import type { DatabaseSync } from "node:sqlite";

/**
 * Runs `work` inside one SQLite transaction, rolling back if it raises.
 *
 * @remarks
 * The store's two multi-statement writes — applying the pending migrations,
 * and recording one rating — are both all-or-nothing, and this is the single
 * place that spelling lives so neither can drift from the other.
 *
 * The rollback is guarded by `isTransaction` rather than issued
 * unconditionally: SQLite ends the transaction itself on some errors, and a
 * `ROLLBACK` with none open raises, which would replace the failure the caller
 * needs to see with a confusing one about transaction state.
 *
 * @param database - An open connection; nested transactions are not supported.
 * @param work - The statements to run, as one unit.
 * @returns Whatever `work` returned, once the commit succeeded.
 */
export function withTransaction<T>(database: DatabaseSync, work: () => T): T {
  database.exec("BEGIN");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (cause) {
    if (database.isTransaction) {
      database.exec("ROLLBACK");
    }
    throw cause;
  }
}
