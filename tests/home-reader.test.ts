import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import type { Card } from "../src/core/cards/card";
import { openDatabase } from "../src/server/db/connection";
import { createStore, type Store } from "../src/server/db/queries";
import type { ReviewSnapshot } from "../src/server/db/records";
import type { VocabularyLists } from "../src/server/cards";
import { createHomePageReader, type HomePageData } from "../src/server/home";

const NOW = 1_757_000_000_000;
const DAY_MS = 86_400_000;

const REVIEWED_CARD: Card = {
  id: "mitigate--verb",
  headword: "mitigate",
  pos: "verb",
  level: "B2",
  purposes: ["ielts"],
  topics: ["environment"],
  definition: "to make something harmful less severe",
  cloze: "Planting trees can ___ the effects of a heatwave.",
  examples: [
    "The council planted trees to mitigate the summer heat.",
    "Nothing was done to mitigate the damage to the river.",
  ],
};

const UNLEARNED_CARD: Card = {
  id: "curriculum--noun",
  headword: "curriculum",
  pos: "noun",
  level: "C1",
  purposes: ["ielts"],
  topics: ["environment"],
  definition: "the subjects a school teaches",
  cloze: "Music was dropped from the school ___.",
  examples: [
    "The curriculum was rewritten for the new exam.",
    "She teaches a subject that is not on the curriculum.",
  ],
};

const LISTS: VocabularyLists = {
  purposes: [{ id: "ielts", label: "IELTS" }],
  topics: ["environment"],
};

const BEFORE: ReviewSnapshot = {
  state: 0,
  due: NOW,
  stability: 0,
  difficulty: 0,
};

const openConnections: DatabaseSync[] = [];

afterEach(() => {
  while (openConnections.length > 0) {
    openConnections.pop()?.close();
  }
});

function openStore(): Store {
  const database = openDatabase(":memory:");
  openConnections.push(database);
  return createStore(database);
}

function addReview(store: Store, due: number): void {
  const sessionId = store.createSession({
    startedAt: NOW,
    scope: { purpose: "ielts", topics: [], target: null },
    newLimit: 10,
    rememberedBefore: 0,
  });
  store.recordReview({
    sessionId,
    cardId: REVIEWED_CARD.id,
    rating: 3,
    reviewedAt: NOW,
    before: BEFORE,
    after: {
      ...BEFORE,
      due,
      stability: 4.5,
      scheduledDays: 1,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      state: 2,
      lastReview: NOW,
    },
  });
}

function readHome(
  store: Store,
  cards: readonly Card[] = [REVIEWED_CARD, UNLEARNED_CARD],
): Promise<HomePageData> {
  return createHomePageReader({
    store,
    readCards: () => Promise.resolve(cards),
    readLists: () => Promise.resolve(LISTS),
    now: () => NOW,
  })();
}

describe("the Home read model", () => {
  it("reads settings, cards, scheduler state, and history into the figures", async () => {
    const store = openStore();
    store.setSetting("scope", {
      purpose: "ielts",
      topics: [],
      target: { exam: "ielts", score: 7 },
    });
    addReview(store, NOW + 1);

    await expect(readHome(store)).resolves.toStrictEqual({
      scope: {
        purpose: "ielts",
        topics: [],
        target: { exam: "ielts", score: 7 },
      },
      newCardsPerDay: 10,
      purposes: LISTS.purposes,
      topics: LISTS.topics,
      validCardCount: 2,
      dueToday: 1,
      rememberedNow: 1,
      unlearnedCount: 1,
      targetRatio: 0.5,
      canStart: true,
    });
  });

  it("does not start a session when all reviewed cards are due after today", async () => {
    const store = openStore();
    addReview(store, NOW + 2 * DAY_MS);

    await expect(readHome(store, [REVIEWED_CARD])).resolves.toMatchObject({
      dueToday: 0,
      unlearnedCount: 0,
      canStart: false,
    });
  });

  it("excludes retired cards from the valid-card count", async () => {
    const store = openStore();
    const retiredCard: Card = { ...REVIEWED_CARD, retired: true };

    await expect(readHome(store, [retiredCard])).resolves.toMatchObject({
      validCardCount: 0,
      dueToday: 0,
      unlearnedCount: 0,
      canStart: false,
    });
  });
});
