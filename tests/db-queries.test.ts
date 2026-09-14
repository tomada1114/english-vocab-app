import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import * as z from "zod";

import { scopeSchema } from "../src/core/scope";
import { openDatabase } from "../src/server/db/connection";
import { DatabaseError } from "../src/server/db/errors";
import { createStore, type Store } from "../src/server/db/queries";
import type {
  ReviewRecord,
  SchedulingState,
  SessionEnd,
} from "../src/server/db/records";
import { withTransaction } from "../src/server/db/transaction";

// Every case here runs against `:memory:`, so the suite touches no filesystem
// and stays a unit test: what it asserts is the SQL and the row-to-record
// translation, neither of which cares whether the file is real. The
// filesystem-shaped half of the store — WAL, the parent directory, reopening a
// migrated file — is `tests/db-connection.test.ts`.

const openConnections: DatabaseSync[] = [];

afterEach(() => {
  while (openConnections.length > 0) {
    openConnections.pop()?.close();
  }
});

/** A store over a throwaway database, with the connection for raw inspection. */
function openStore(): { database: DatabaseSync; store: Store } {
  const database = openDatabase(":memory:");
  openConnections.push(database);
  return { database, store: createStore(database) };
}

/** A store alone, for the majority of cases that never reach past it. */
function newStore(): Store {
  return openStore().store;
}

const REVIEWED_AT = 1_757_000_000_000;

/** The empty card FSRS starts from: never reviewed, nothing scheduled. */
const NEW_CARD: SchedulingState = {
  state: 0,
  due: REVIEWED_AT,
  stability: 0,
  difficulty: 0,
  scheduledDays: 0,
  learningSteps: 0,
  reps: 0,
  lapses: 0,
  lastReview: null,
};

function schedulingState(overrides: Partial<SchedulingState> = {}): SchedulingState {
  return { ...NEW_CARD, ...overrides };
}

/** One rating of `mitigate--verb`, answered Good in session 1. */
function reviewRecord(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    sessionId: 1,
    cardId: "mitigate--verb",
    rating: 3,
    reviewedAt: REVIEWED_AT,
    before: NEW_CARD,
    after: schedulingState({
      state: 1,
      due: REVIEWED_AT + 600_000,
      stability: 3.5,
      difficulty: 5.25,
      learningSteps: 1,
      reps: 1,
      lastReview: REVIEWED_AT,
    }),
    ...overrides,
  };
}

/** Whatever `work` threw, or `undefined` when it did not throw. */
function thrown(work: () => unknown): unknown {
  try {
    work();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe("getCardStates", () => {
  it("returns nothing for a database nobody has reviewed in", () => {
    expect(newStore().getCardStates()).toStrictEqual([]);
  });

  it("returns the state a rating left, as the record it was written from", () => {
    const store = newStore();
    const review = reviewRecord();

    store.recordReview(review);

    expect(store.getCardStates()).toStrictEqual([
      { cardId: "mitigate--verb", ...review.after },
    ]);
  });

  it("keeps one row per card, updated by the latest rating", () => {
    const store = newStore();
    store.recordReview(reviewRecord());
    store.recordReview(
      reviewRecord({
        reviewedAt: REVIEWED_AT + 600_000,
        after: schedulingState({ state: 2, stability: 9.75, reps: 2, lapses: 1 }),
      }),
    );

    const states = store.getCardStates();

    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ state: 2, stability: 9.75, reps: 2, lapses: 1 });
  });

  it("orders the cards by id", () => {
    const store = newStore();
    for (const cardId of ["well-being--noun", "carbon-footprint--noun"]) {
      store.recordReview(reviewRecord({ cardId }));
    }

    expect(store.getCardStates().map((state) => state.cardId)).toStrictEqual([
      "carbon-footprint--noun",
      "well-being--noun",
    ]);
  });
});

describe("recordReview", () => {
  it("writes the log row with both sides of the rating", () => {
    const store = newStore();

    store.recordReview(reviewRecord());

    expect(store.listReviewLogs()).toStrictEqual([
      {
        id: 1,
        cardId: "mitigate--verb",
        sessionId: 1,
        rating: 3,
        reviewedAt: REVIEWED_AT,
        before: { state: 0, due: REVIEWED_AT, stability: 0, difficulty: 0 },
        after: {
          state: 1,
          due: REVIEWED_AT + 600_000,
          stability: 3.5,
          difficulty: 5.25,
        },
      },
    ]);
  });

  // A fractional timestamp is rejected by the STRICT `review_log.reviewed_at`
  // column, and only after `card_state` has already been written — which is
  // exactly the half-applied rating the transaction exists to prevent.
  it("leaves card_state untouched when the log row is rejected", () => {
    const store = newStore();
    store.recordReview(reviewRecord());
    const before = store.getCardStates();

    const error = thrown(() => {
      store.recordReview(
        reviewRecord({
          reviewedAt: REVIEWED_AT + 0.5,
          after: schedulingState({ state: 3, stability: 99, reps: 7 }),
        }),
      );
    });

    expect(error).toBeInstanceOf(Error);
    expect(store.getCardStates()).toStrictEqual(before);
    expect(store.listReviewLogs()).toHaveLength(1);
  });

  it("never adds a card_state row when the first rating of a card is rejected", () => {
    const store = newStore();

    thrown(() => {
      store.recordReview(reviewRecord({ reviewedAt: REVIEWED_AT + 0.5 }));
    });

    expect(store.getCardStates()).toStrictEqual([]);
    expect(store.listReviewLogs()).toStrictEqual([]);
  });
});

describe("withTransaction", () => {
  it("hands back what the work returned, once it has committed", () => {
    const { database, store } = openStore();

    const tally = withTransaction(database, () => {
      store.setSetting("newCardsPerDay", 10);
      return store.countFirstReviewsSince(0);
    });

    expect(tally).toBe(0);
    expect(database.isTransaction).toBe(false);
  });

  // SQLite ends the transaction itself on some failures. Issuing a ROLLBACK
  // with none open raises, which would replace the failure the caller needs to
  // see with a confusing one about transaction state.
  it("skips the rollback when the failure already ended the transaction", () => {
    const { database } = openStore();
    const failure = new Error("the work raised after the transaction ended");

    const error = thrown(() =>
      withTransaction(database, () => {
        database.exec("ROLLBACK");
        throw failure;
      }),
    );

    expect(error).toBe(failure);
    expect(database.isTransaction).toBe(false);
  });

  it("refuses to nest, rather than let SQLite raise its own less specific error", () => {
    const { database } = openStore();
    database.exec("BEGIN");

    const error = thrown(() => withTransaction(database, () => undefined));

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("does not support nesting");
    // The guard fires before touching BEGIN or ROLLBACK, so the caller's own
    // already-open transaction is exactly as it left it.
    expect(database.isTransaction).toBe(true);
    database.exec("ROLLBACK");
  });

  it("rolls the whole composed operation back when one step nests by mistake", () => {
    const { database, store } = openStore();

    const error = thrown(() =>
      withTransaction(database, () => {
        store.setSetting("newCardsPerDay", 10);
        withTransaction(database, () => undefined);
      }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(database.isTransaction).toBe(false);
    expect(store.getSetting("newCardsPerDay", z.number())).toBeUndefined();
  });
});

describe("listReviewLogs", () => {
  it("returns every rating ever given, oldest first", () => {
    const store = newStore();
    for (const reviewedAt of [REVIEWED_AT + 2, REVIEWED_AT, REVIEWED_AT + 1]) {
      store.recordReview(reviewRecord({ reviewedAt }));
    }

    expect(store.listReviewLogs().map((log) => log.reviewedAt)).toStrictEqual([
      REVIEWED_AT,
      REVIEWED_AT + 1,
      REVIEWED_AT + 2,
    ]);
  });
});

describe("countFirstReviewsSince", () => {
  /** Two cards: one first seen a day ago, one first seen today and re-rated. */
  function storeWithHistory(): Store {
    const store = newStore();
    store.recordReview({
      ...reviewRecord({ cardId: "carbon-footprint--noun" }),
      reviewedAt: REVIEWED_AT - 86_400_000,
    });
    store.recordReview(reviewRecord({ cardId: "mitigate--verb" }));
    store.recordReview(
      reviewRecord({ cardId: "mitigate--verb", reviewedAt: REVIEWED_AT + 60_000 }),
    );
    return store;
  }

  it("counts nothing in an empty database", () => {
    expect(newStore().countFirstReviewsSince(0)).toBe(0);
  });

  it("counts each card once, however often it was rated afterwards", () => {
    expect(storeWithHistory().countFirstReviewsSince(REVIEWED_AT - 3_600_000)).toBe(1);
  });

  it("counts a card whose first rating is exactly at the boundary", () => {
    expect(storeWithHistory().countFirstReviewsSince(REVIEWED_AT)).toBe(1);
  });

  it("counts every card when the boundary is before all of them", () => {
    expect(storeWithHistory().countFirstReviewsSince(0)).toBe(2);
  });

  it("counts none when the boundary is after the last rating", () => {
    expect(storeWithHistory().countFirstReviewsSince(REVIEWED_AT + 3_600_000)).toBe(0);
  });
});

describe("sessions", () => {
  const scope = { purpose: "ielts", topics: ["environment"], target: null };

  function openSession(store: Store): number {
    return store.createSession({
      startedAt: REVIEWED_AT,
      scope,
      newLimit: 10,
      rememberedBefore: 12.5,
    });
  }

  it("returns a fresh id for each session opened", () => {
    const store = newStore();

    expect([openSession(store), openSession(store)]).toStrictEqual([1, 2]);
  });

  it("reads an open session back with its scope and nothing ended", () => {
    const store = newStore();

    expect(store.getSession(openSession(store))).toStrictEqual({
      id: 1,
      startedAt: REVIEWED_AT,
      endedAt: null,
      scope,
      newLimit: 10,
      rememberedBefore: 12.5,
      rememberedAfter: null,
    });
  });

  it("returns undefined for a session id nothing opened", () => {
    expect(newStore().getSession(404)).toBeUndefined();
  });

  it("records the end of a session", () => {
    const store = newStore();
    const end: SessionEnd = {
      id: openSession(store),
      endedAt: REVIEWED_AT + 900_000,
      rememberedAfter: 17.25,
    };

    store.endSession(end);

    expect(store.getSession(end.id)).toMatchObject({
      endedAt: REVIEWED_AT + 900_000,
      rememberedAfter: 17.25,
    });
  });

  it("leaves the table alone when the session to end is not there", () => {
    const store = newStore();

    store.endSession({ id: 404, endedAt: REVIEWED_AT, rememberedAfter: 1 });

    expect(store.getSession(404)).toBeUndefined();
  });

  it("refuses a scope that has no JSON form", () => {
    const store = newStore();

    const error = thrown(() =>
      store.createSession({
        startedAt: REVIEWED_AT,
        scope: undefined,
        newLimit: 10,
        rememberedBefore: 0,
      }),
    );

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toMatchObject({ code: "ERR_DB_VALUE_UNSERIALIZABLE" });
  });

  // `JSON.stringify` returns `undefined` for `undefined`, a function or a
  // symbol (the case above), but *raises* for a circular reference or a
  // `BigInt` instead — a second failure shape `toJson` catches separately.
  it("refuses a scope with a circular reference, which JSON.stringify raises on rather than returning undefined for", () => {
    const store = newStore();
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    const error = thrown(() =>
      store.createSession({
        startedAt: REVIEWED_AT,
        scope: circular,
        newLimit: 10,
        rememberedBefore: 0,
      }),
    );

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toMatchObject({ code: "ERR_DB_VALUE_UNSERIALIZABLE" });
  });

  it("reports a scope column that is not JSON", () => {
    const { database, store } = openStore();
    const id = openSession(store);
    database.exec(`UPDATE session SET scope = 'not json' WHERE id = ${String(id)}`);

    const error = thrown(() => store.getSession(id));

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toMatchObject({ code: "ERR_DB_VALUE_CORRUPT" });
  });
});

describe("settings", () => {
  const newCardsPerDay = z.int().positive();
  const initialScope = { purpose: "ielts", topics: ["education"], target: null };

  it("returns undefined for a key nobody has set", () => {
    expect(newStore().getSetting("newCardsPerDay", newCardsPerDay)).toBeUndefined();
  });

  it("round-trips a value through its JSON column", () => {
    const store = newStore();

    store.setSetting("newCardsPerDay", 10);

    expect(store.getSetting("newCardsPerDay", newCardsPerDay)).toBe(10);
  });

  it("round-trips a structured value", () => {
    const store = newStore();
    const schema = z.object({ purpose: z.string(), topics: z.array(z.string()) });

    store.setSetting("scope", { purpose: "ielts", topics: ["health", "food"] });

    expect(store.getSetting("scope", schema)).toStrictEqual({
      purpose: "ielts",
      topics: ["health", "food"],
    });
  });

  it("replaces whatever the key held", () => {
    const store = newStore();
    store.setSetting("newCardsPerDay", 10);

    store.setSetting("newCardsPerDay", 25);

    expect(store.getSetting("newCardsPerDay", newCardsPerDay)).toBe(25);
  });

  it("replaces the scope and daily limit together", () => {
    const store = newStore();
    const replacement = {
      scope: { purpose: "ielts", topics: ["environment"], target: null },
      newCardsPerDay: 25,
    };

    store.replaceSettings(replacement);

    expect(store.getSetting("scope", scopeSchema)).toStrictEqual(replacement.scope);
    expect(store.getSetting("newCardsPerDay", newCardsPerDay)).toBe(25);
  });

  it("rolls back both settings when the second replacement write fails", () => {
    const store = newStore();
    store.replaceSettings({ scope: initialScope, newCardsPerDay: 10 });

    const error = thrown(() => {
      store.replaceSettings({
        scope: { purpose: "ielts", topics: ["environment"], target: null },
        // The first upsert must be rolled back when serializing the second
        // value fails after the transaction has already started.
        newCardsPerDay: undefined as unknown as number,
      });
    });

    expect(error).toBeInstanceOf(Error);
    expect(store.getSetting("scope", scopeSchema)).toStrictEqual(initialScope);
    expect(store.getSetting("newCardsPerDay", newCardsPerDay)).toBe(10);
  });

  it("refuses a value that has no JSON form", () => {
    const error = thrown(() => {
      newStore().setSetting("scope", undefined);
    });

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toMatchObject({ code: "ERR_DB_VALUE_UNSERIALIZABLE" });
  });

  it("reports a stored value the caller's schema does not describe", () => {
    const store = newStore();
    store.setSetting("newCardsPerDay", "ten");

    const error = thrown(() => store.getSetting("newCardsPerDay", newCardsPerDay));

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toMatchObject({ code: "ERR_DB_VALUE_SCHEMA_MISMATCH" });
  });

  it("reports a stored value that is not JSON at all", () => {
    const { database, store } = openStore();
    database.exec("INSERT INTO setting (key, value) VALUES ('scope', '{oops')");

    const error = thrown(() => store.getSetting("scope", z.unknown()));

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toMatchObject({ code: "ERR_DB_VALUE_CORRUPT" });
  });

  it("names the key in the message and never the value that was stored", () => {
    const store = newStore();
    store.setSetting("newCardsPerDay", "a-secret-looking-value");

    const error = thrown(() => store.getSetting("newCardsPerDay", newCardsPerDay));

    expect(String(error)).toContain("newCardsPerDay");
    expect(String(error)).not.toContain("a-secret-looking-value");
  });
});
