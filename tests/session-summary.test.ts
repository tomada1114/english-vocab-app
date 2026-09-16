import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../src/server/db/connection";
import { createStore, type Store } from "../src/server/db/queries";
import { createSessionSummaryReader } from "../src/server/summary";
import type { ReviewSnapshot } from "../src/server/db/records";
import type { Card } from "../src/core/cards/card";

// What the summary screen reads. The stored before/after values describe the
// session itself, while the curve uses all review history in its saved scope.

const NOW = 1_757_000_000_000;

const openConnections: DatabaseSync[] = [];

const CARD: Card = {
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

const OTHER_CARD: Card = {
  ...CARD,
  id: "curriculum--noun",
  headword: "curriculum",
  pos: "noun",
};

afterEach(() => {
  while (openConnections.length > 0) {
    openConnections.pop()?.close();
  }
});

function newStore(): Store {
  const database = openDatabase(":memory:");
  openConnections.push(database);
  return createStore(database);
}

const ALL_TOPICS_SCOPE = { purpose: "ielts", topics: [], target: null };

function openSession(
  store: Store,
  rememberedBefore: number,
  scope: unknown = ALL_TOPICS_SCOPE,
): number {
  return store.createSession({
    startedAt: NOW,
    scope,
    newLimit: 10,
    rememberedBefore,
  });
}

function rate(store: Store, sessionId: number, cardId: string): void {
  const snapshot: ReviewSnapshot = {
    state: 0,
    due: NOW,
    stability: 0,
    difficulty: 0,
  };
  store.recordReview({
    sessionId,
    cardId,
    rating: 3,
    reviewedAt: NOW,
    before: snapshot,
    after: {
      ...snapshot,
      state: 1,
      stability: 3.5,
      scheduledDays: 0,
      learningSteps: 1,
      reps: 1,
      lapses: 0,
      lastReview: NOW,
    },
  });
}

function readSummary(store: Store): ReturnType<typeof createSessionSummaryReader> {
  return createSessionSummaryReader({
    store,
    readCards: () => Promise.resolve([CARD, OTHER_CARD]),
    now: () => NOW,
  });
}

describe("the session summary reader", () => {
  it("reports nothing for an id no session was ever opened under", () => {
    return expect(readSummary(newStore())(404)).resolves.toBeUndefined();
  });

  it("reports a finished session's counts and current curve", async () => {
    const store = newStore();
    const id = openSession(store, 12.5);
    rate(store, id, "mitigate--verb");
    store.endSession({ id, endedAt: NOW + 60_000, rememberedAfter: 13.25 });

    await expect(readSummary(store)(id)).resolves.toStrictEqual({
      reviewed: 1,
      rememberedBefore: 12.5,
      rememberedAfter: 13.25,
      dailyCurve: [{ atMs: NOW, remembered: 1 }],
    });
  });

  it("reports a session that was never ended, with nothing measured after it", async () => {
    const store = newStore();
    const id = openSession(store, 12.5);

    await expect(readSummary(store)(id)).resolves.toStrictEqual({
      reviewed: 0,
      rememberedBefore: 12.5,
      rememberedAfter: null,
      dailyCurve: [],
    });
  });

  // `reviewed` is read through `store.countSessionReviews` (see
  // `tests/db-queries.test.ts` for that method's own suite); this proves the
  // summary reader wires it to the right session id rather than the whole log.
  it("counts only the named session's ratings, with another session's present", async () => {
    const store = newStore();
    const first = openSession(store, 0);
    const second = openSession(store, 0);
    rate(store, first, "mitigate--verb");
    rate(store, first, "curriculum--noun");
    rate(store, second, "carbon-footprint--noun");

    await expect(readSummary(store)(first)).resolves.toMatchObject({ reviewed: 2 });
    await expect(readSummary(store)(second)).resolves.toMatchObject({ reviewed: 1 });
  });

  it("builds the curve from all history in the session's stored scope", async () => {
    const store = newStore();
    const earlier = openSession(store, 0);
    const current = openSession(store, 0);
    rate(store, earlier, CARD.id);
    rate(store, current, OTHER_CARD.id);

    await expect(readSummary(store)(current)).resolves.toMatchObject({
      dailyCurve: [{ atMs: NOW, remembered: 2 }],
    });
  });

  it("keeps the curve unchanged when an out-of-scope card has history", async () => {
    const store = newStore();
    const outOfScopeCard: Card = {
      ...OTHER_CARD,
      id: "resilience--noun",
      topics: ["work"],
    };
    const scope = { purpose: "ielts", topics: ["environment"], target: null };
    const id = openSession(store, 0, scope);
    rate(store, id, CARD.id);
    rate(store, id, outOfScopeCard.id);

    const summary = await createSessionSummaryReader({
      store,
      readCards: () => Promise.resolve([CARD, outOfScopeCard]),
      now: () => NOW,
    })(id);

    // CARD is topics: ["environment"], in the session's saved scope;
    // outOfScopeCard (topics: ["work"]) is not, so its rating must not move
    // the curve — the same figure as if it had never been rated.
    expect(summary).toMatchObject({ dailyCurve: [{ atMs: NOW, remembered: 1 }] });
  });
});
