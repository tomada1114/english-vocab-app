import "server-only";

import type { Card, Purpose } from "../core/cards/card";
import {
  dailyCurve,
  rememberedNow,
  targetRatio,
  unlearnedCount,
  type CurvePoint,
} from "../core/progress";
import { dayBounds } from "../core/scheduler";
import { inScope, type Scope } from "../core/scope";
import { buildQueue } from "../core/session";
import type { VocabularyLists } from "./cards";
import type { Store } from "./db/queries";
import {
  readNewCardsPerDay,
  readScope,
  reviewsOf,
  schedulerStates,
} from "./handlers/session-context";

/** The serializable read model rendered by the Home Server Component. */
export interface HomePageData {
  readonly scope: Scope;
  readonly newCardsPerDay: number;
  readonly purposes: readonly Purpose[];
  readonly topics: readonly string[];
  /** Valid, active cards; retired cards are excluded from every count. */
  readonly validCardCount: number;
  readonly dueToday: number;
  readonly rememberedNow: number;
  readonly unlearnedCount: number;
  readonly targetRatio: number | null;
  readonly dailyCurve: readonly CurvePoint[];
  readonly canStart: boolean;
}

/** Runtime dependencies for the Home read model. */
export interface HomePageDependencies {
  readonly store: Store;
  readonly readCards: () => Promise<readonly Card[]>;
  readonly readLists: () => Promise<VocabularyLists>;
  readonly now: () => number;
}

/** Builds the Home read model from the current database and deck. */
export function createHomePageReader(
  dependencies: HomePageDependencies,
): () => Promise<HomePageData> {
  return async (): Promise<HomePageData> => {
    const scope = readScope(dependencies.store);
    const newCardsPerDay = readNewCardsPerDay(dependencies.store);
    const [cards, lists] = await Promise.all([
      dependencies.readCards(),
      dependencies.readLists(),
    ]);
    const states = schedulerStates(dependencies.store);
    if (!states.ok) {
      throw new Error("The Home page could not read card scheduling state.");
    }

    const nowMs = dependencies.now();
    const day = dayBounds(nowMs);
    const scopedCards = cards.filter((card) => inScope(card, scope));
    const dueToday = scopedCards.filter((card) => {
      const state = states.value.get(card.id);
      return state !== undefined && state.due < day.end;
    }).length;
    const queue = buildQueue({
      cards: scopedCards,
      states: states.value,
      nowMs,
      dayEndMs: day.end,
      newCardsPerDay,
      newIntroducedToday: dependencies.store.countFirstReviewsSince(day.start),
    });
    const progress = {
      cards,
      reviews: reviewsOf(dependencies.store.listReviewLogs()),
      scope,
    };

    return {
      scope,
      newCardsPerDay,
      purposes: lists.purposes,
      topics: lists.topics,
      validCardCount: cards.filter((card) => card.retired !== true).length,
      dueToday,
      rememberedNow: rememberedNow(progress, nowMs),
      unlearnedCount: unlearnedCount(progress),
      targetRatio: targetRatio(progress, nowMs),
      dailyCurve: dailyCurve(progress, nowMs),
      canStart: queue.length > 0,
    };
  };
}
