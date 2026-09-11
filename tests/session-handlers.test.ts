import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import type { Card } from "../src/core/cards/card";
import { LEARN_AHEAD_MS } from "../src/core/session";
import { POST as END_ROUTE } from "../src/app/api/sessions/[id]/end/route";
import { POST as REVIEWS_ROUTE } from "../src/app/api/sessions/[id]/reviews/route";
import { POST as SESSIONS_ROUTE } from "../src/app/api/sessions/route";
import { endSession, recordReview, startSession } from "../src/server/composition";
import { openDatabase } from "../src/server/db/connection";
import { createStore, type Store } from "../src/server/db/queries";
import { createEndSessionHandler } from "../src/server/handlers/end-session";
import { createRecordReviewHandler } from "../src/server/handlers/record-review";
import { createStartSessionHandler } from "../src/server/handlers/start-session";
import type { SessionDependencies } from "../src/server/handlers/session-context";

// The three handlers of the study session, driven the way `writing-tests`
// settles it: a real `new Request(...)`, a `:memory:` database, and a deck
// handed over as fixture cards. Nothing is mocked — the store, the deck and
// the clock are arguments because the factories ask for them — so what runs
// here is the same code a request runs, minus the framework that routes it.

/** The instant every case is run at; a real clock would make the queue move. */
const NOW = 1_757_000_000_000;

const DAY_MS = 86_400_000;

const MITIGATE: Card = {
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

const CURRICULUM: Card = {
  id: "curriculum--noun",
  headword: "curriculum",
  pos: "noun",
  level: "B1",
  purposes: ["ielts"],
  topics: ["education"],
  definition: "the subjects a school teaches",
  cloze: "Music was dropped from the school ___ last year.",
  examples: [
    "The curriculum was rewritten for the new exam.",
    "She teaches a subject that is not on the curriculum.",
  ],
};

const CARBON_FOOTPRINT: Card = {
  id: "carbon-footprint--noun",
  headword: "carbon footprint",
  pos: "noun",
  level: "C1",
  purposes: ["ielts"],
  topics: ["environment"],
  definition: "the amount of greenhouse gas one person or activity produces",
  cloze: "Flying less is the quickest way to cut your ___.",
  examples: [
    "The report measured the carbon footprint of each factory.",
    "A vegetarian diet has a smaller carbon footprint.",
  ],
};

const DECK: readonly Card[] = [MITIGATE, CURRICULUM, CARBON_FOOTPRINT];

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

function dependenciesOver(
  store: Store,
  deck: readonly Card[] = DECK,
): SessionDependencies {
  return { store, readCards: () => Promise.resolve(deck), now: () => NOW };
}

/** A rating already in the database, leaving the card due at `dueMs`. */
function alreadyRated(store: Store, cardId: string, dueMs: number): void {
  const before = {
    state: 0,
    due: NOW - DAY_MS,
    stability: 0,
    difficulty: 0,
  };
  store.recordReview({
    sessionId: 1,
    cardId,
    rating: 3,
    reviewedAt: NOW - DAY_MS,
    before,
    after: {
      state: 2,
      due: dueMs,
      stability: 4.5,
      difficulty: 5,
      scheduledDays: 1,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      lastReview: NOW - DAY_MS,
    },
  });
}

function postTo(url: string, body?: unknown): Request {
  return new Request(url, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** The parsed body of a response, whatever shape it turned out to have. */
async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("POST /api/sessions", () => {
  async function start(store: Store, deck?: readonly Card[]): Promise<Response> {
    const handler = createStartSessionHandler(dependenciesOver(store, deck));
    return handler(postTo("http://localhost/api/sessions"));
  }

  async function queuedIds(store: Store, deck?: readonly Card[]): Promise<unknown> {
    const body = await bodyOf(await start(store, deck));
    return (body["queue"] as { cardId: string }[]).map((entry) => entry.cardId);
  }

  it("puts the cards due today first, then the new ones by level", async () => {
    const { store } = openStore();
    alreadyRated(store, MITIGATE.id, NOW - DAY_MS);

    expect(await queuedIds(store)).toStrictEqual([
      "mitigate--verb",
      "curriculum--noun",
      "carbon-footprint--noun",
    ]);
  });

  it("leaves out a reviewed card that is not due until after today", async () => {
    const { store } = openStore();
    alreadyRated(store, MITIGATE.id, NOW + 10 * DAY_MS);

    expect(await queuedIds(store)).toStrictEqual([
      "curriculum--noun",
      "carbon-footprint--noun",
    ]);
  });

  it("draws only the cards the stored scope selects", async () => {
    const { store } = openStore();
    store.setSetting("scope", {
      purpose: "ielts",
      topics: ["education"],
      target: null,
    });

    expect(await queuedIds(store)).toStrictEqual(["curriculum--noun"]);
  });

  it("draws no more new cards than the stored daily limit", async () => {
    const { store } = openStore();
    store.setSetting("newCardsPerDay", 1);

    expect(await queuedIds(store)).toStrictEqual(["curriculum--noun"]);
  });

  it("sends each card's front and back together", async () => {
    const { store } = openStore();

    const body = await bodyOf(await start(store, [CURRICULUM]));

    expect(body["queue"]).toStrictEqual([
      {
        cardId: "curriculum--noun",
        definition: "the subjects a school teaches",
        cloze: "Music was dropped from the school ___ last year.",
        headword: "curriculum",
        examples: [
          "The curriculum was rewritten for the new exam.",
          "She teaches a subject that is not on the curriculum.",
        ],
      },
    ]);
  });

  it("opens a session row carrying the scope it ran with", async () => {
    const { store } = openStore();
    const scope = { purpose: "ielts", topics: ["environment"], target: null };
    store.setSetting("scope", scope);

    const body = await bodyOf(await start(store));

    expect(body["sessionId"]).toBe(1);
    expect(store.getSession(1)).toStrictEqual({
      id: 1,
      startedAt: NOW,
      endedAt: null,
      scope,
      newLimit: 10,
      rememberedBefore: 0,
      rememberedAfter: null,
    });
  });

  it("answers JSON", async () => {
    const { store } = openStore();

    const response = await start(store);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

describe("POST /api/sessions/[id]/reviews", () => {
  /** A store with one open session, whose id is always 1. */
  function storeWithSession(): Store {
    const { store } = openStore();
    store.createSession({
      startedAt: NOW,
      scope: { purpose: "ielts", topics: [], target: null },
      newLimit: 10,
      rememberedBefore: 0,
    });
    return store;
  }

  function review(store: Store, id: number, body?: unknown): Promise<Response> {
    const handler = createRecordReviewHandler(dependenciesOver(store));
    return handler(postTo(`http://localhost/api/sessions/${String(id)}/reviews`, body));
  }

  it("refuses a session id nothing ever opened", async () => {
    const response = await review(storeWithSession(), 404, {
      cardId: MITIGATE.id,
      rating: 3,
    });

    expect(response.status).toBe(404);
    // The code is the contract and the message is prose, so only the first is
    // pinned — `designing-errors` holds the reasoning. What the message owes
    // is to be there at all.
    const { error } = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(error.code).toBe("ERR_SESSION_NOT_FOUND");
    expect(error.message.length).toBeGreaterThan(0);
  });

  it.each([
    ["a rating below the scale", { cardId: MITIGATE.id, rating: 0 }],
    ["a rating above the scale", { cardId: MITIGATE.id, rating: 5 }],
    ["a fractional rating", { cardId: MITIGATE.id, rating: 3.5 }],
    ["a rating sent as text", { cardId: MITIGATE.id, rating: "3" }],
    ["no rating at all", { cardId: MITIGATE.id }],
    ["an empty card id", { cardId: "", rating: 3 }],
    ["a field the schema does not declare", { cardId: MITIGATE.id, rating: 3, n: 1 }],
    ["a JSON array", [MITIGATE.id, 3]],
    ["a bare JSON string", "mitigate--verb"],
  ])("refuses %s", async (_case, body) => {
    const response = await review(storeWithSession(), 1, body);

    expect(response.status).toBe(400);
    expect((await bodyOf(response))["error"]).toMatchObject({
      code: "ERR_SESSION_REQUEST_INVALID",
    });
  });

  it("refuses a body that is not JSON at all", async () => {
    const store = storeWithSession();
    const handler = createRecordReviewHandler(dependenciesOver(store));

    const response = await handler(
      new Request("http://localhost/api/sessions/1/reviews", {
        method: "POST",
        body: "not json",
      }),
    );

    expect(response.status).toBe(400);
    expect((await bodyOf(response))["error"]).toMatchObject({
      code: "ERR_BAD_REQUEST",
    });
  });

  it("refuses a card the deck does not hold", async () => {
    const response = await review(storeWithSession(), 1, {
      cardId: "no-such-card--noun",
      rating: 3,
    });

    expect(response.status).toBe(400);
    expect((await bodyOf(response))["error"]).toMatchObject({
      code: "ERR_SESSION_CARD_NOT_FOUND",
    });
  });

  it("refuses a path whose session segment is not a number", async () => {
    const store = storeWithSession();
    const handler = createRecordReviewHandler(dependenciesOver(store));

    const response = await handler(
      postTo("http://localhost/api/sessions/one/reviews", {
        cardId: MITIGATE.id,
        rating: 3,
      }),
    );

    expect(response.status).toBe(404);
    expect((await bodyOf(response))["error"]).toMatchObject({
      code: "ERR_SESSION_NOT_FOUND",
    });
  });

  it("reads the same session id through a trailing slash", async () => {
    const store = storeWithSession();
    const handler = createRecordReviewHandler(dependenciesOver(store));

    const response = await handler(
      postTo("http://localhost/api/sessions/1/reviews/", {
        cardId: MITIGATE.id,
        rating: 3,
      }),
    );

    expect(response.status).toBe(200);
    expect(store.listReviewLogs()).toHaveLength(1);
  });

  // A phase outside FSRS's four is a row no version of this app writes; what
  // it must not do is end the session it appears in.
  it("rates a card whose stored phase is not one FSRS knows, as a new card", async () => {
    const store = storeWithSession();
    store.recordReview({
      sessionId: 1,
      cardId: MITIGATE.id,
      rating: 3,
      reviewedAt: NOW - DAY_MS,
      before: { state: 0, due: NOW - DAY_MS, stability: 0, difficulty: 0 },
      after: {
        state: 7,
        due: NOW - DAY_MS,
        stability: 4.5,
        difficulty: 5,
        scheduledDays: 1,
        learningSteps: 0,
        reps: 1,
        lapses: 0,
        lastReview: NOW - DAY_MS,
      },
    });

    const response = await review(store, 1, { cardId: MITIGATE.id, rating: 3 });

    expect(response.status).toBe(200);
    expect(store.listReviewLogs()[1]?.before.state).toBe(0);
  });

  it("writes nothing when the rating is refused", async () => {
    const store = storeWithSession();

    await review(store, 1, { cardId: MITIGATE.id, rating: 9 });

    expect(store.getCardStates()).toStrictEqual([]);
    expect(store.listReviewLogs()).toStrictEqual([]);
  });

  it("persists the card's new state and the log row it came from", async () => {
    const store = storeWithSession();

    await review(store, 1, { cardId: MITIGATE.id, rating: 3 });

    const states = store.getCardStates();
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ cardId: "mitigate--verb", reps: 1 });

    const logs = store.listReviewLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      cardId: "mitigate--verb",
      sessionId: 1,
      rating: 3,
      reviewedAt: NOW,
    });
  });

  it("brings a card rated Again back into the same session", async () => {
    const body = await bodyOf(
      await review(storeWithSession(), 1, { cardId: MITIGATE.id, rating: 1 }),
    );

    expect(body["requeue"]).toBe(true);
    expect(body["due"]).toBeLessThanOrEqual(NOW + LEARN_AHEAD_MS);
  });

  it("lets a card rated Easy leave the session", async () => {
    const body = await bodyOf(
      await review(storeWithSession(), 1, { cardId: MITIGATE.id, rating: 4 }),
    );

    expect(body["requeue"]).toBe(false);
    expect(body["due"]).toBeGreaterThan(NOW + LEARN_AHEAD_MS);
  });
});

describe("POST /api/sessions/[id]/end", () => {
  function end(store: Store, id: number): Promise<Response> {
    const handler = createEndSessionHandler(dependenciesOver(store));
    return handler(postTo(`http://localhost/api/sessions/${String(id)}/end`));
  }

  async function sessionWithOneRating(store: Store): Promise<void> {
    const start = createStartSessionHandler(dependenciesOver(store));
    await start(postTo("http://localhost/api/sessions"));
    const review = createRecordReviewHandler(dependenciesOver(store));
    await review(
      postTo("http://localhost/api/sessions/1/reviews", {
        cardId: MITIGATE.id,
        rating: 3,
      }),
    );
  }

  it("reports what the session came to", async () => {
    const { store } = openStore();
    await sessionWithOneRating(store);

    const body = await bodyOf(await end(store, 1));

    // One card, rated at the instant the figure is read: the forgetting curve
    // is 1 at the review, so remembered-after is exactly one card.
    expect(body["reviewed"]).toBe(1);
    expect(body["rememberedBefore"]).toBe(0);
    expect(body["rememberedAfter"]).toBeCloseTo(1, 10);
  });

  it("closes the session row it reported on", async () => {
    const { store } = openStore();
    await sessionWithOneRating(store);

    await end(store, 1);

    expect(store.getSession(1)).toMatchObject({ endedAt: NOW });
    expect(store.getSession(1)?.rememberedAfter).toBeCloseTo(1, 10);
  });

  it("refuses a session id nothing ever opened", async () => {
    const { store } = openStore();

    const response = await end(store, 7);

    expect(response.status).toBe(404);
    expect((await bodyOf(response))["error"]).toMatchObject({
      code: "ERR_SESSION_NOT_FOUND",
    });
  });

  it("refuses to measure against a stored scope that is no longer one", async () => {
    const { database, store } = openStore();
    await sessionWithOneRating(store);
    database.exec(`UPDATE session SET scope = '{"purpose":1}' WHERE id = 1`);

    const response = await end(store, 1);

    expect(response.status).toBe(500);
    expect((await bodyOf(response))["error"]).toMatchObject({
      code: "ERR_SESSION_SCOPE_CORRUPT",
    });
    expect(store.getSession(1)?.endedAt).toBeNull();
  });
});

describe("the Route Handlers", () => {
  // Each route file is one re-export line, so the only thing left to assert
  // about it is that identity; everything else is a test of the handler the
  // composition root built.
  it.each([
    ["src/app/api/sessions/route.ts", SESSIONS_ROUTE, startSession],
    ["src/app/api/sessions/[id]/reviews/route.ts", REVIEWS_ROUTE, recordReview],
    ["src/app/api/sessions/[id]/end/route.ts", END_ROUTE, endSession],
  ])("mounts %s on the composed handler", (_file, route, handler) => {
    expect(route).toBe(handler);
  });
});
