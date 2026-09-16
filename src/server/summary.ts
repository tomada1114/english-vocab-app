import "server-only";

import type { Card } from "../core/cards/card";
import { dailyCurve, type CurvePoint } from "../core/progress";
import { scopeSchema } from "../core/scope";
import type { Store } from "./db/queries";
import { reviewsOf, scopedCardIds } from "./handlers/session-context";

/**
 * What one finished session reads as.
 *
 * @remarks
 * The before and after values are read back out of the `session` row so the
 * summary shows the session that happened rather than what the same scope
 * would score now. The curve is deliberately recomputed from current history
 * for the scope the session captured.
 */
export interface SessionSummary {
  /** How many ratings were recorded against the session. */
  readonly reviewed: number;
  readonly rememberedBefore: number;
  /** `null` while the session was never ended. */
  readonly rememberedAfter: number | null;
  /** The current curve for the scope captured when this session started. */
  readonly dailyCurve: readonly CurvePoint[];
}

/** Runtime dependencies for the database-backed session summary. */
export interface SessionSummaryDependencies {
  readonly store: Store;
  readonly readCards: () => Promise<readonly Card[]>;
  readonly now: () => number;
}

/**
 * Reads one session back for the summary screen.
 *
 * @remarks
 * A factory over the store for the same reason the handlers are: the page that
 * renders this receives it from the composition root, and a test builds one
 * over `:memory:`.
 *
 * @returns The summary, or `undefined` for an id nothing opened — which the
 * page answers with its own 404 rather than an empty summary.
 */
export function createSessionSummaryReader(
  dependencies: SessionSummaryDependencies,
): (sessionId: number) => Promise<SessionSummary | undefined> {
  return async (sessionId) => {
    const session = dependencies.store.getSession(sessionId);
    if (session === undefined) {
      return undefined;
    }
    const scope = scopeSchema.parse(session.scope);
    const cards = await dependencies.readCards();
    return {
      reviewed: dependencies.store.countSessionReviews(sessionId),
      rememberedBefore: session.rememberedBefore,
      rememberedAfter: session.rememberedAfter,
      dailyCurve: dailyCurve(
        {
          cards,
          reviews: reviewsOf(
            dependencies.store.listReviewLogsForCards(scopedCardIds(cards, scope)),
          ),
          scope,
        },
        dependencies.now(),
      ),
    };
  };
}
