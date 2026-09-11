import "server-only";

import type { Store } from "./db/queries";

/**
 * What one finished session reads as.
 *
 * @remarks
 * Every figure is read back out of the `session` row and the log rather than
 * recomputed, so the summary shows the session that happened rather than what
 * the same scope would score now — a page reopened an hour later says the same
 * thing it said when the session ended.
 */
export interface SessionSummary {
  /** How many ratings were recorded against the session. */
  readonly reviewed: number;
  readonly rememberedBefore: number;
  /** `null` while the session was never ended. */
  readonly rememberedAfter: number | null;
}

/**
 * How many ratings `sessionId` collected.
 *
 * @remarks
 * Counted from the whole append-only log rather than by a query of its own:
 * the table is one person's review history, and a scan of it is cheaper than
 * the index a rarer question would cost to keep. `Store` gains a counting
 * query the day that stops being true.
 */
export function countSessionReviews(store: Store, sessionId: number): number {
  return store.listReviewLogs().filter((log) => log.sessionId === sessionId).length;
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
  store: Store,
): (sessionId: number) => SessionSummary | undefined {
  return (sessionId) => {
    const session = store.getSession(sessionId);
    if (session === undefined) {
      return undefined;
    }
    return {
      reviewed: countSessionReviews(store, sessionId),
      rememberedBefore: session.rememberedBefore,
      rememberedAfter: session.rememberedAfter,
    };
  };
}
