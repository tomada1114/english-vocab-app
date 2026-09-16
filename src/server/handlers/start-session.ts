import "server-only";

import type { Card } from "../../core/cards/card";
import { rememberedNow } from "../../core/progress";
import { dayBounds } from "../../core/scheduler";
import { inScope } from "../../core/scope";
import { buildQueue } from "../../core/session";
import type { RequestHandler } from "../http";
import {
  readNewCardsPerDay,
  readScope,
  reviewsOf,
  schedulerStatesFor,
  type SessionDependencies,
} from "./session-context";

/**
 * One card as the study page renders it: the front it is asked with and the
 * back it is answered by, sent together so revealing costs no request.
 */
export interface QueuedCard {
  readonly cardId: string;
  readonly definition: string;
  readonly cloze: string;
  readonly headword: string;
  readonly examples: readonly [string, string];
}

/** What `POST /api/sessions` answers with. */
export interface StartedSession {
  readonly sessionId: number;
  readonly queue: readonly QueuedCard[];
}

function toQueuedCard(card: Card): QueuedCard {
  return {
    cardId: card.id,
    definition: card.definition,
    cloze: card.cloze,
    headword: card.headword,
    examples: card.examples,
  };
}

/**
 * Opens a study session: `POST /api/sessions`.
 *
 * @remarks
 * Everything the session runs on is decided here and handed to the page in one
 * answer — the scope and the daily new-card limit as the owner last set them,
 * the queue `src/core/session.ts` builds from them, and the id every rating is
 * recorded against. `remembered_before` is computed and stored now rather than
 * at the end, so the summary can report the change over the session even
 * though the figure moves with time on its own.
 *
 * The deck is read whole and filtered by scope here, while the progress figure
 * is computed over every card: `rememberedNow` applies the scope itself, and
 * handing it a pre-filtered list would only hide that from a reader.
 *
 * The queue's scheduler states and `rememberedBefore`'s review history are
 * both read for the in-scope cards only, one point-scope query each, over the
 * same scoped card array — built once, so it and the ids handed to those two
 * reads cannot drift apart.
 *
 * It takes no request body. A session carries no options — the scope is a
 * setting, not a parameter — so there is nothing for a caller to send and
 * nothing to validate.
 */
export function createStartSessionHandler(
  dependencies: SessionDependencies,
): RequestHandler {
  const { store, readCards, now } = dependencies;

  return async (): Promise<Response> => {
    const scope = readScope(store);
    const newCardsPerDay = readNewCardsPerDay(store);
    const cards = await readCards();
    const nowMs = now();
    const day = dayBounds(nowMs);
    const scopedCards = cards.filter((card) => inScope(card, scope));
    const ids = scopedCards.map((card) => card.id);
    const states = schedulerStatesFor(store, ids);
    if (!states.ok) {
      return states.error;
    }

    const queue = buildQueue({
      cards: scopedCards,
      states: states.value,
      nowMs,
      dayEndMs: day.end,
      newCardsPerDay,
      newIntroducedToday: store.countFirstReviewsSince(day.start),
    });

    const rememberedBefore = rememberedNow(
      { cards, reviews: reviewsOf(store.listReviewLogsForCards(ids)), scope },
      nowMs,
    );
    const sessionId = store.createSession({
      startedAt: nowMs,
      scope,
      newLimit: newCardsPerDay,
      rememberedBefore,
    });

    const byId = new Map(cards.map((card) => [card.id, card]));
    const answer: StartedSession = {
      sessionId,
      queue: queue.flatMap((id) => {
        const card = byId.get(id);
        return card === undefined ? [] : [toQueuedCard(card)];
      }),
    };
    return Response.json(answer);
  };
}
