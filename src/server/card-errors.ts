import "server-only";

/**
 * Why one file under `data/` could not be read as what it declares.
 *
 * @remarks
 * Four structurally different failures, so a caller can tell a malformed file
 * from a misfiled one. Every other card rule — an id that does not match its
 * key, an unknown topic, the text itself — is the Lint's vocabulary instead.
 */
export type CardLoadErrorCode =
  | "ERR_CARD_UNREADABLE"
  | "ERR_CARD_INVALID_JSON"
  | "ERR_CARD_SCHEMA"
  | "ERR_CARD_ID_MISMATCH";

/** One file under `data/` that could not be loaded, and why. */
export class CardLoadError extends Error {
  /** A literal union, not `string`: this is what a caller narrows on. */
  readonly code: CardLoadErrorCode;
  /** The path that failed — never the content that was at it. */
  readonly file: string;

  constructor(
    code: CardLoadErrorCode,
    file: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CardLoadError";
    this.code = code;
    this.file = file;
  }
}
