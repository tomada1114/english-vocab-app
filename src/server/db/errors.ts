import "server-only";

/**
 * Why an operation against the vocabulary database could not be completed.
 *
 * @remarks
 * Three structurally different failures, so a caller can tell "this build
 * cannot read this file" from "this file is damaged". Everything else a query
 * can fail with is SQLite's own error, raised by `node:sqlite` and left as it
 * is: wrapping a constraint violation would only hide which constraint.
 */
export type DatabaseErrorCode =
  /** A migration raised, and the whole batch was rolled back. */
  | "ERR_DB_MIGRATION"
  /** The file's `user_version` is ahead of the migrations this build knows. */
  | "ERR_DB_VERSION_AHEAD"
  /** A JSON column held something the caller's schema does not describe. */
  | "ERR_DB_VALUE_INVALID";

/** One failure of the SQLite store, named by a code a caller can branch on. */
export class DatabaseError extends Error {
  /** A literal union, not `string`: this is what a caller narrows on. */
  readonly code: DatabaseErrorCode;

  constructor(code: DatabaseErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DatabaseError";
    this.code = code;
  }
}
