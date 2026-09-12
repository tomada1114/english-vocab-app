import "server-only";

import * as z from "zod";

import { rate } from "../../core/scheduler";
import { afterRating } from "../../core/session";
import { readJsonBody, type RequestHandler } from "../http";
import {
  findSession,
  schedulerStates,
  sessionFailure,
  type SessionDependencies,
} from "./session-context";

/**
 * The longest card id a rating may name.
 *
 * @remarks
 * An id is derived from a headword and a part of speech, so a real one is a
 * few dozen characters; this is a ceiling on what the handler will carry into
 * a lookup and a log row, not a shape rule. The card-id contract itself is
 * `src/core/cards/card.ts`'s.
 */
const MAX_CARD_ID_LENGTH = 128;

/**
 * What `POST /api/sessions/[id]/reviews` accepts.
 *
 * @remarks
 * Strict, so a misspelled field is a refusal rather than a rating silently
 * applied with a default. The rating is the closed set of FSRS grades: 0
 * ("Manual") is not one of them, and neither is anything outside 1–4.
 */
const ratingRequestSchema = z.strictObject({
  cardId: z.string().min(1).max(MAX_CARD_ID_LENGTH),
  rating: z.literal([1, 2, 3, 4]),
});

/** What `POST /api/sessions/[id]/reviews` answers with. */
export interface RecordedReview {
  /** Whether the card comes back before this session ends. */
  readonly requeue: boolean;
  /** When the card is next due, as epoch milliseconds. */
  readonly due: number;
}

/**
 * Records one rating: `POST /api/sessions/[id]/reviews`.
 *
 * @remarks
 * The order of the refusals is deliberate. The session is resolved from the
 * path before the body is read, so a request against a session that was never
 * opened is refused without buffering anything; the body is then read through
 * `readJsonBody`, which bounds what is buffered, and only afterwards is the
 * card looked up in the deck.
 *
 * `requeue` is answered by asking `afterRating` — the module that owns the
 * 20-minute learn-ahead rule — what it does to a queue holding only this card,
 * rather than by comparing instants here. The page keeps its own queue, so the
 * rule has to be stated once and read from both sides of the request.
 */
export function createRecordReviewHandler(
  dependencies: SessionDependencies,
): RequestHandler {
  const { store, readCards, now } = dependencies;

  return async (request: Request): Promise<Response> => {
    const session = findSession(store, request);
    if (!session.ok) {
      return session.error;
    }

    const body = await readJsonBody(request);
    if (!body.ok) {
      return body.error;
    }

    const parsed = ratingRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return sessionFailure("ERR_SESSION_REQUEST_INVALID");
    }
    const { cardId, rating } = parsed.data;

    const cards = await readCards();
    if (!cards.some((card) => card.id === cardId)) {
      return sessionFailure("ERR_SESSION_CARD_NOT_FOUND");
    }

    const states = schedulerStates(store);
    if (!states.ok) {
      return states.error;
    }
    const nowMs = now();
    const outcome = rate(states.value.get(cardId) ?? null, rating, nowMs);
    store.recordReview({
      sessionId: session.value.id,
      cardId,
      rating,
      reviewedAt: nowMs,
      before: outcome.before,
      after: outcome.after,
    });

    const answer: RecordedReview = {
      requeue: afterRating([cardId], cardId, outcome.after.due, nowMs).includes(cardId),
      due: outcome.after.due,
    };
    return Response.json(answer);
  };
}
