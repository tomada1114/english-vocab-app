import { describe, expect, it } from "vitest";

import type { Card, Level } from "../src/core/cards/card";
import type { SchedulerPhase, SchedulerState } from "../src/core/scheduler";
import { LEARN_AHEAD_MS, afterRating, buildQueue, nextCard } from "../src/core/session";

// Every rule asserted here comes from
// `.agents/skills/building-the-vocab-app/references/storage-and-scheduling.md`
// § "The session queue": due-today order, the daily new-card quota, the
// deterministic new-card order, and the 20-minute learn-ahead requeue.

const MINUTE = 60_000;
const DAY = 86_400_000;
const NOW = Date.parse("2026-03-07T12:00:00Z");
const DAY_END = Date.parse("2026-03-08T04:00:00Z");

/** A minimal card, varying only what a given test cares about. */
function card(id: string, level: Level = "B1"): Card {
  return {
    id,
    headword: id,
    pos: "noun",
    level,
    purposes: ["ielts"],
    topics: ["environment"],
    definition: "a definition",
    cloze: "A ___ sentence.",
    examples: ["Example one.", "Example two."],
  };
}

/** A reviewed card's scheduler state, varying only `due` and `state`. */
function state(due: number, phase: SchedulerPhase = 2): SchedulerState {
  return {
    due,
    stability: 10,
    difficulty: 5,
    scheduledDays: 1,
    learningSteps: 0,
    reps: 1,
    lapses: 0,
    state: phase,
    lastReview: due - DAY,
  };
}

describe("buildQueue orders reviewed cards by due, earliest first", () => {
  it("puts the earliest-due reviewed card ahead of a later one", () => {
    const cards = [card("late"), card("early")];
    const states = new Map([
      ["late", state(NOW + 2 * MINUTE)],
      ["early", state(NOW + MINUTE)],
    ]);
    const queue = buildQueue({
      cards,
      states,
      nowMs: NOW,
      dayEndMs: DAY_END,
      newCardsPerDay: 0,
      newIntroducedToday: 0,
    });
    expect(queue).toStrictEqual(["early", "late"]);
  });

  it("excludes a reviewed card not due until well past the day end", () => {
    const cards = [card("soon"), card("later")];
    const states = new Map([
      ["soon", state(NOW + MINUTE)],
      ["later", state(DAY_END + 7 * DAY)],
    ]);
    const queue = buildQueue({
      cards,
      states,
      nowMs: NOW,
      dayEndMs: DAY_END,
      newCardsPerDay: 0,
      newIntroducedToday: 0,
    });
    expect(queue).toStrictEqual(["soon"]);
  });

  it("excludes a card due exactly at the day end and includes one just before it", () => {
    const cards = [card("at-boundary"), card("before-boundary")];
    const states = new Map([
      ["at-boundary", state(DAY_END)],
      ["before-boundary", state(DAY_END - 1)],
    ]);
    const queue = buildQueue({
      cards,
      states,
      nowMs: NOW,
      dayEndMs: DAY_END,
      newCardsPerDay: 0,
      newIntroducedToday: 0,
    });
    expect(queue).toStrictEqual(["before-boundary"]);
  });

  it("places every reviewed card ahead of every new card", () => {
    const cards = [card("new-1"), card("reviewed-1")];
    const states = new Map([["reviewed-1", state(NOW + MINUTE)]]);
    const queue = buildQueue({
      cards,
      states,
      nowMs: NOW,
      dayEndMs: DAY_END,
      newCardsPerDay: 10,
      newIntroducedToday: 0,
    });
    expect(queue).toStrictEqual(["reviewed-1", "new-1"]);
  });
});

describe("buildQueue draws new cards only up to the day's remaining quota", () => {
  const NEW_CARDS = Array.from({ length: 10 }, (_, index) =>
    card(`new-${String(index)}`),
  );

  it("draws the remainder of a 10-per-day quota after 4 introduced today", () => {
    const queue = buildQueue({
      cards: NEW_CARDS,
      states: new Map(),
      nowMs: NOW,
      dayEndMs: DAY_END,
      newCardsPerDay: 10,
      newIntroducedToday: 4,
    });
    expect(queue).toHaveLength(6);
  });

  it("draws none once the quota is exhausted for the day", () => {
    const queue = buildQueue({
      cards: NEW_CARDS,
      states: new Map(),
      nowMs: NOW,
      dayEndMs: DAY_END,
      newCardsPerDay: 10,
      newIntroducedToday: 10,
    });
    expect(queue).toHaveLength(0);
  });

  it("never goes negative when more cards were introduced than the quota allows", () => {
    const queue = buildQueue({
      cards: NEW_CARDS,
      states: new Map(),
      nowMs: NOW,
      dayEndMs: DAY_END,
      newCardsPerDay: 10,
      newIntroducedToday: 15,
    });
    expect(queue).toHaveLength(0);
  });
});

describe("buildQueue orders new cards by level, then deterministically by id", () => {
  it("orders new cards by CEFR level ascending", () => {
    const cards = [card("c1-card", "C1"), card("a1-card", "A1"), card("b1-card", "B1")];
    const queue = buildQueue({
      cards,
      states: new Map(),
      nowMs: NOW,
      dayEndMs: DAY_END,
      newCardsPerDay: 10,
      newIntroducedToday: 0,
    });
    expect(queue).toStrictEqual(["a1-card", "b1-card", "c1-card"]);
  });

  it("orders same-level new cards the same way on every call", () => {
    const cards = [card("zebra", "B1"), card("apple", "B1"), card("mango", "B1")];
    const input = {
      cards,
      states: new Map(),
      nowMs: NOW,
      dayEndMs: DAY_END,
      newCardsPerDay: 10,
      newIntroducedToday: 0,
    };
    const first = buildQueue(input);
    const second = buildQueue({ ...input, cards: [...cards] });
    expect(first).toStrictEqual(second);
    // Not alphabetical or insertion order — a stable hash of the id, so this
    // pins the exact order rather than merely "some deterministic order".
    expect(first).toStrictEqual(["mango", "apple", "zebra"]);
  });
});

describe("afterRating requeues or drops a card by the 20-minute learn-ahead window", () => {
  it("sends a card rated Again back to the end of the queue", () => {
    const queue = ["a", "b", "c"];
    const afterDueMs = NOW + MINUTE; // e.g. the first FSRS learning step
    expect(afterRating(queue, "a", afterDueMs, NOW)).toStrictEqual(["b", "c", "a"]);
  });

  it("keeps a card requeued right at the edge of the learn-ahead window", () => {
    const queue = ["a", "b"];
    const afterDueMs = NOW + LEARN_AHEAD_MS;
    expect(afterRating(queue, "a", afterDueMs, NOW)).toStrictEqual(["b", "a"]);
  });

  it("drops a card scheduled a day ahead instead of requeuing it", () => {
    const queue = ["a", "b", "c"];
    const afterDueMs = NOW + DAY;
    expect(afterRating(queue, "a", afterDueMs, NOW)).toStrictEqual(["b", "c"]);
  });

  it("drops a card scheduled just past the learn-ahead window", () => {
    const queue = ["a", "b"];
    const afterDueMs = NOW + LEARN_AHEAD_MS + 1;
    expect(afterRating(queue, "a", afterDueMs, NOW)).toStrictEqual(["b"]);
  });
});

describe("nextCard serves the queue without stalling on a learning-step timer", () => {
  it("returns the head of the queue", () => {
    expect(nextCard(["a", "b"], new Map(), NOW)).toBe("a");
  });

  it("returns null once the queue is empty", () => {
    expect(nextCard([], new Map(), NOW)).toBeNull();
  });

  it("returns the earliest card when every remaining card is a not-yet-due learning card", () => {
    const states = new Map([
      ["later", state(NOW + 10 * MINUTE, 1)],
      ["sooner", state(NOW + MINUTE, 1)],
    ]);
    expect(nextCard(["later", "sooner"], states, NOW)).toBe("sooner");
  });

  it("skips a not-yet-due learning card in favor of a card that is ready", () => {
    const states = new Map([
      ["learning", state(NOW + 10 * MINUTE, 1)],
      ["mature", state(NOW - MINUTE, 2)],
    ]);
    expect(nextCard(["learning", "mature"], states, NOW)).toBe("mature");
  });

  it("treats a new card, with no state at all, as always ready", () => {
    const states = new Map([["learning", state(NOW + 10 * MINUTE, 1)]]);
    expect(nextCard(["learning", "new-card"], states, NOW)).toBe("new-card");
  });

  it("treats a not-yet-due relearning card the same as a not-yet-due learning card", () => {
    const states = new Map([
      ["relearning", state(NOW + 10 * MINUTE, 3)],
      ["mature", state(NOW - MINUTE, 2)],
    ]);
    expect(nextCard(["relearning", "mature"], states, NOW)).toBe("mature");
  });
});
