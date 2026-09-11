import "server-only";

import { rememberedNow } from "../../core/progress";
import { scopeSchema } from "../../core/scope";
import type { RequestHandler } from "../http";
import { countSessionReviews } from "../summary";
import {
  findSession,
  reviewsOf,
  sessionFailure,
  type SessionDependencies,
} from "./session-context";

/** What `POST /api/sessions/[id]/end` answers with. */
export interface EndedSession {
  readonly reviewed: number;
  readonly rememberedBefore: number;
  readonly rememberedAfter: number;
}

/**
 * Closes a study session: `POST /api/sessions/[id]/end`.
 *
 * @remarks
 * `remembered_after` is computed against the scope the session was opened
 * with, read back off its own row rather than off the settings: the owner may
 * have narrowed the scope while the session ran, and a before and an after
 * measured over different sets of cards would not be a change in anything.
 *
 * Ending a session that is already ended is not refused. Nothing is lost by
 * it — every rating was stored as it happened — and the alternative is a
 * failure the study page would have to handle on the one path where the owner
 * has already left it.
 */
export function createEndSessionHandler(
  dependencies: SessionDependencies,
): RequestHandler {
  const { store, readCards, now } = dependencies;

  return async (request: Request): Promise<Response> => {
    const session = findSession(store, request);
    if (!session.ok) {
      return session.error;
    }

    const scope = scopeSchema.safeParse(session.value.scope);
    if (!scope.success) {
      return sessionFailure("ERR_SESSION_SCOPE_CORRUPT");
    }

    const nowMs = now();
    const rememberedAfter = rememberedNow(
      {
        cards: await readCards(),
        reviews: reviewsOf(store.listReviewLogs()),
        scope: scope.data,
      },
      nowMs,
    );
    store.endSession({ id: session.value.id, endedAt: nowMs, rememberedAfter });

    const answer: EndedSession = {
      reviewed: countSessionReviews(store, session.value.id),
      rememberedBefore: session.value.rememberedBefore,
      rememberedAfter,
    };
    return Response.json(answer);
  };
}
