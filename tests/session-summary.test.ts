import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../src/server/db/connection";
import { createStore, type Store } from "../src/server/db/queries";
import { countSessionReviews, createSessionSummaryReader } from "../src/server/summary";

// What the summary screen reads. Every figure comes back out of the rows the
// session left behind rather than being recomputed, so these cases are about
// which rows are counted — the session's own, and no other's.

const NOW = 1_757_000_000_000;

const openConnections: DatabaseSync[] = [];

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

function openSession(store: Store, rememberedBefore: number): number {
  return store.createSession({
    startedAt: NOW,
    scope: { purpose: "ielts", topics: [], target: null },
    newLimit: 10,
    rememberedBefore,
  });
}

function rate(store: Store, sessionId: number, cardId: string): void {
  const snapshot = { state: 0, due: NOW, stability: 0, difficulty: 0 };
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

describe("countSessionReviews", () => {
  it("counts nothing for a session nobody rated a card in", () => {
    const store = newStore();

    expect(countSessionReviews(store, openSession(store, 0))).toBe(0);
  });

  it("counts every rating of the session, and none of another's", () => {
    const store = newStore();
    const first = openSession(store, 0);
    const second = openSession(store, 0);
    rate(store, first, "mitigate--verb");
    rate(store, first, "curriculum--noun");
    rate(store, second, "carbon-footprint--noun");

    expect([
      countSessionReviews(store, first),
      countSessionReviews(store, second),
    ]).toStrictEqual([2, 1]);
  });

  it("counts a card rated twice in one session twice", () => {
    const store = newStore();
    const id = openSession(store, 0);
    rate(store, id, "mitigate--verb");
    rate(store, id, "mitigate--verb");

    expect(countSessionReviews(store, id)).toBe(2);
  });
});

describe("the session summary reader", () => {
  it("reports nothing for an id no session was ever opened under", () => {
    expect(createSessionSummaryReader(newStore())(404)).toBeUndefined();
  });

  it("reports a finished session's counts", () => {
    const store = newStore();
    const id = openSession(store, 12.5);
    rate(store, id, "mitigate--verb");
    store.endSession({ id, endedAt: NOW + 60_000, rememberedAfter: 13.25 });

    expect(createSessionSummaryReader(store)(id)).toStrictEqual({
      reviewed: 1,
      rememberedBefore: 12.5,
      rememberedAfter: 13.25,
    });
  });

  it("reports a session that was never ended, with nothing measured after it", () => {
    const store = newStore();
    const id = openSession(store, 12.5);

    expect(createSessionSummaryReader(store)(id)).toStrictEqual({
      reviewed: 0,
      rememberedBefore: 12.5,
      rememberedAfter: null,
    });
  });
});
