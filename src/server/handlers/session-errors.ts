import "server-only";

import { failure } from "../http";

/**
 * Every way a study-session request is refused by this layer.
 *
 * @remarks
 * The body-read vocabulary — `ERR_BAD_REQUEST` and `ERR_PAYLOAD_TOO_LARGE` —
 * belongs to `src/server/http.ts` and is answered there; these are the
 * failures that need the session and the deck to be decided at all.
 */
export type SessionErrorCode =
  /** The body is JSON, but not `{ cardId, rating }` with a rating of 1–4. */
  | "ERR_SESSION_REQUEST_INVALID"
  /** The path names no session this database has opened. */
  | "ERR_SESSION_NOT_FOUND"
  /** The rated card id is in no file under the card directory. */
  | "ERR_SESSION_CARD_NOT_FOUND"
  /** The session row's stored scope no longer matches the scope schema. */
  | "ERR_SESSION_SCOPE_CORRUPT"
  /** A stored card state names no scheduler phase. */
  | "ERR_SESSION_CARD_STATE_CORRUPT";

/**
 * The status each code is answered with.
 *
 * @remarks
 * `as const satisfies` rather than an annotation: a code added to the union
 * above fails to compile here until it has been given a status, instead of
 * falling through to a default nobody chose.
 */
export const SESSION_ERROR_STATUS = {
  ERR_SESSION_REQUEST_INVALID: 400,
  ERR_SESSION_NOT_FOUND: 404,
  ERR_SESSION_CARD_NOT_FOUND: 400,
  ERR_SESSION_SCOPE_CORRUPT: 500,
  ERR_SESSION_CARD_STATE_CORRUPT: 500,
} as const satisfies Record<SessionErrorCode, number>;

/**
 * One fixed sentence per code.
 *
 * @remarks
 * Each names the shape of what was refused and never the content that was
 * sent: a card id or a rating quoted back here would be copied into every log
 * that records the answer. `designing-errors` holds the rule.
 */
export const SESSION_ERROR_MESSAGE = {
  ERR_SESSION_REQUEST_INVALID:
    "The request body must be an object with a card id and a rating of 1, 2, 3 or 4.",
  ERR_SESSION_NOT_FOUND: "The path does not name a session that was ever opened.",
  ERR_SESSION_CARD_NOT_FOUND: "The request names a card the deck does not hold.",
  ERR_SESSION_SCOPE_CORRUPT:
    "The scope stored against that session does not match the scope schema.",
  ERR_SESSION_CARD_STATE_CORRUPT:
    "A card's stored scheduling state does not name a phase the scheduler knows.",
} as const satisfies Record<SessionErrorCode, string>;

/** The answer one of these codes is sent as. */
export function sessionFailure(code: SessionErrorCode): Response {
  return failure(SESSION_ERROR_STATUS[code], code, SESSION_ERROR_MESSAGE[code]);
}
