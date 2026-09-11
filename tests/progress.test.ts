import { describe, expect, it } from "vitest";

import type { Card, Level } from "../src/core/cards/card";
import {
  dailyCurve,
  rememberedNow,
  targetRatio,
  unlearnedCount,
  type ProgressInput,
  type Review,
} from "../src/core/progress";
import type { Scope } from "../src/core/scope";

// Every expected number here comes from outside the module under test:
// `.agents/skills/building-the-vocab-app/references/storage-and-scheduling.md`
// § "Progress" for what each figure counts, and FSRS's own definition of
// stability for the two values of R this suite is built on — 1 at the review
// itself, and 0.9 exactly one stability later. Nothing recomputes the
// forgetting curve the way the implementation does.

const DAY = 86_400_000;

/** A fixed instant to read the figures at, so nothing depends on the clock. */
const NOW = Date.parse("2026-03-07T12:00:00Z");

/**
 * The zone every day boundary here is read in.
 *
 * @remarks
 * Named rather than left to the process, both because a test must not depend
 * on the machine's zone and because UTC never shifts, so a study day is always
 * 24 hours and the rollovers below can be written out as instants.
 */
const ZONE = "UTC";

/** A minimal card, varying only what a given test cares about. */
function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    headword: id,
    pos: "noun",
    level: "B2",
    purposes: ["ielts"],
    topics: ["environment"],
    definition: "a definition",
    cloze: "A ___ sentence.",
    examples: ["Example one.", "Example two."],
    ...overrides,
  };
}

/** A rating of `cardId`, `stabilityAfter` days' worth of memory strong. */
function review(cardId: string, reviewedAt: number, stabilityAfter: number): Review {
  return { cardId, reviewedAt, stabilityAfter };
}

/** Every card serving `ielts`, at every level and topic. */
const EVERYTHING: Scope = { purpose: "ielts", topics: [], target: null };

/**
 * A fixture whose remembered-now is 1.9 by hand.
 *
 * @remarks
 * `fresh` was rated at `NOW`, so its R is 1. `aged` was rated exactly one
 * stability ago — 20 days, stability 20 — so its R is 0.9, which is what
 * stability means. `unlearned` has never been rated and adds 0, `retired` is
 * out of every count however recently it was rated, and `other` serves a
 * different purpose.
 */
const FIXTURE: ProgressInput = {
  cards: [
    card("fresh"),
    card("aged"),
    card("unlearned"),
    card("retired", { retired: true }),
    card("other", { purposes: ["toefl"] }),
  ],
  reviews: [
    review("fresh", NOW, 10),
    review("aged", NOW - 20 * DAY, 20),
    review("retired", NOW, 10),
    review("other", NOW, 10),
  ],
  scope: EVERYTHING,
};

describe("rememberedNow sums the recall probability of the cards in scope", () => {
  it("equals the hand-computed 1.9 for the fixture", () => {
    expect(rememberedNow(FIXTURE, NOW)).toBeCloseTo(1.9, 6);
  });

  it("counts a card rated at the instant it is read as a whole card", () => {
    const input = {
      ...FIXTURE,
      cards: [card("fresh")],
      reviews: [review("fresh", NOW, 3)],
    };
    expect(rememberedNow(input, NOW)).toBe(1);
  });

  it("counts nothing for a scope whose cards have never been rated", () => {
    const input = { ...FIXTURE, cards: [card("unlearned")], reviews: [] };
    expect(rememberedNow(input, NOW)).toBe(0);
  });

  it("counts nothing for a retired card, however recently it was rated", () => {
    const input: ProgressInput = {
      cards: [card("retired", { retired: true })],
      reviews: [review("retired", NOW, 10)],
      scope: EVERYTHING,
    };
    expect(rememberedNow(input, NOW)).toBe(0);
  });

  it("reads a card through its latest rating, not every rating it has had", () => {
    const input: ProgressInput = {
      cards: [card("fresh")],
      reviews: [review("fresh", NOW - 30 * DAY, 1), review("fresh", NOW, 10)],
      scope: EVERYTHING,
    };
    expect(rememberedNow(input, NOW)).toBe(1);
  });

  it("ignores a rating that had not happened yet at the instant asked about", () => {
    const input: ProgressInput = {
      cards: [card("fresh")],
      reviews: [review("fresh", NOW, 10)],
      scope: EVERYTHING,
    };
    expect(rememberedNow(input, NOW - DAY)).toBe(0);
  });

  it("follows the scope: a narrowed topic drops the cards outside it", () => {
    const input: ProgressInput = {
      cards: [card("fresh"), card("health", { topics: ["health"] })],
      reviews: [review("fresh", NOW, 10), review("health", NOW, 10)],
      scope: { purpose: "ielts", topics: ["health"], target: null },
    };
    expect(rememberedNow(input, NOW)).toBe(1);
  });
});

describe("unlearnedCount counts the in-scope cards with no review", () => {
  it("counts only the unrated, non-retired card of the fixture", () => {
    expect(unlearnedCount(FIXTURE)).toBe(1);
  });

  it("counts every card of a scope nobody has studied", () => {
    const input = { ...FIXTURE, cards: [card("a"), card("b"), card("c")], reviews: [] };
    expect(unlearnedCount(input)).toBe(3);
  });

  it("counts nothing once every in-scope card has been rated", () => {
    const input: ProgressInput = {
      cards: [card("fresh")],
      reviews: [review("fresh", NOW - 90 * DAY, 10)],
      scope: EVERYTHING,
    };
    expect(unlearnedCount(input)).toBe(0);
  });
});

describe("targetRatio divides remembered now by the cards in the target scope", () => {
  const TARGETED: Scope = {
    purpose: "ielts",
    topics: [],
    target: { exam: "ielts", score: 7 },
  };

  it("is null when no target is set, because there is nothing to show", () => {
    expect(targetRatio(FIXTURE, NOW)).toBeNull();
  });

  it("is one remembered card out of the two in the target scope", () => {
    const input: ProgressInput = {
      cards: [card("fresh"), card("unlearned", { level: "C1" })],
      reviews: [review("fresh", NOW, 10)],
      scope: TARGETED,
    };
    expect(targetRatio(input, NOW)).toBe(0.5);
  });

  it("is null when the target scope holds no cards at all", () => {
    const input: ProgressInput = {
      cards: [card("beginner", { level: "A1" })],
      reviews: [],
      scope: TARGETED,
    };
    expect(targetRatio(input, NOW)).toBeNull();
  });

  it("leaves the cards outside the target's two levels out of the denominator", () => {
    const input: ProgressInput = {
      cards: [
        card("fresh"),
        card("beginner", { level: "A1" }),
        card("mastered", { level: "C2" }),
      ],
      reviews: [review("fresh", NOW, 10)],
      scope: TARGETED,
    };
    expect(targetRatio(input, NOW)).toBe(1);
  });
});

describe("dailyCurve gives one point per study day since the first review", () => {
  const FIRST = Date.parse("2026-03-04T09:00:00Z");

  /** Two cards, first rated three study days before `NOW`. */
  const HISTORY: ProgressInput = {
    cards: [card("fresh"), card("aged")],
    reviews: [review("fresh", FIRST, 30), review("aged", NOW - 2 * DAY, 20)],
    scope: EVERYTHING,
  };

  it("runs from the first review's day to today, each point at the 04:00 rollover", () => {
    expect(dailyCurve(HISTORY, NOW, ZONE).map((point) => point.atMs)).toStrictEqual([
      Date.parse("2026-03-04T04:00:00Z"),
      Date.parse("2026-03-05T04:00:00Z"),
      Date.parse("2026-03-06T04:00:00Z"),
      NOW,
    ]);
  });

  it("takes today's point at now, so it equals remembered now", () => {
    const curve = dailyCurve(HISTORY, NOW, ZONE);
    expect(curve[curve.length - 1]).toStrictEqual({
      atMs: NOW,
      remembered: rememberedNow(HISTORY, NOW),
    });
  });

  it("starts at zero, before the day's first review had happened", () => {
    expect(dailyCurve(HISTORY, NOW, ZONE)[0]).toStrictEqual({
      atMs: Date.parse("2026-03-04T04:00:00Z"),
      remembered: 0,
    });
  });

  it("counts a card from the rollover after it was first rated", () => {
    // `fresh` was rated on the 4th with stability 30, so at the 5th's rollover
    // it is 19 hours old: recall is still high, but no longer the whole card.
    const second = dailyCurve(HISTORY, NOW, ZONE)[1];
    expect(second?.remembered).toBeGreaterThan(0.9);
    expect(second?.remembered).toBeLessThan(1);
  });

  it("gives a scope that never ran a session no curve at all", () => {
    const input: ProgressInput = {
      cards: [card("unlearned")],
      reviews: [],
      scope: EVERYTHING,
    };
    expect(dailyCurve(input, NOW, ZONE)).toStrictEqual([]);
  });

  it("gives no curve when every review belongs to a card outside the scope", () => {
    const input: ProgressInput = {
      cards: [card("health", { topics: ["health"] })],
      reviews: [review("health", FIRST, 30)],
      scope: { purpose: "ielts", topics: ["environment"], target: null },
    };
    expect(dailyCurve(input, NOW, ZONE)).toStrictEqual([]);
  });

  it("gives one point, taken at now, when the first review is today", () => {
    const input: ProgressInput = {
      cards: [card("fresh")],
      reviews: [review("fresh", NOW - 60_000, 10)],
      scope: EVERYTHING,
    };
    expect(dailyCurve(input, NOW, ZONE)).toStrictEqual([
      { atMs: NOW, remembered: rememberedNow(input, NOW) },
    ]);
  });
});

describe("dailyCurve stays affordable at the size this app was designed for", () => {
  const CARDS = 3_000;
  const DAYS = 365;
  /** The bound `building-the-vocab-app` accepts for a render-time recompute. */
  const BUDGET_MS = 2_000;

  const LEVELS_IN_USE: readonly Level[] = ["A2", "B1", "B2", "C1"];

  /**
   * Every card rated on the first day and four times after it, so all 3,000
   * are in the sum on all 365 days — the ~1.1M curve evaluations the design
   * budgets for, rather than a history that quietly evaluates fewer.
   */
  function synthetic(): ProgressInput {
    const start = NOW - (DAYS - 1) * DAY;
    const cards: Card[] = [];
    const reviews: Review[] = [];
    for (let index = 0; index < CARDS; index++) {
      const id = `card-${String(index)}`;
      cards.push(
        card(id, { level: LEVELS_IN_USE[index % LEVELS_IN_USE.length] ?? "B2" }),
      );
      for (const offset of [0, 90, 180, 270]) {
        reviews.push(
          review(id, start + (offset + (index % 30)) * DAY, 10 + (index % 50)),
        );
      }
    }
    return { cards, reviews, scope: EVERYTHING };
  }

  it(`walks 3,000 cards over 365 days in under ${String(BUDGET_MS)} ms`, () => {
    const input = synthetic();

    const started = performance.now();
    const curve = dailyCurve(input, NOW, ZONE);
    const elapsed = performance.now() - started;

    expect(curve).toHaveLength(DAYS);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
