import { describe, expect, expectTypeOf, it } from "vitest";

import {
  dayBounds,
  rate,
  retrievability,
  type Rating,
  type SchedulerState,
} from "../src/core/scheduler";

// Every expected number here is written by hand from a source outside the
// module: the learning steps and the 04:00 rollover from
// `.agents/skills/building-the-vocab-app/references/storage-and-scheduling.md`
// § "Scheduling", the intervals those steps produce from ts-fsrs's own `Steps`
// documentation, the meaning of stability from FSRS itself, and the UTC
// offsets of America/Denver and Asia/Tokyo from the IANA rules.

const MINUTE = 60_000;
const DAY = 86_400_000;

/** A fixed instant to rate at, so no assertion depends on the wall clock. */
const NOW = Date.parse("2026-03-07T12:00:00Z");

/**
 * A card already in review, mature enough that fuzz moves its next interval.
 *
 * @remarks
 * ts-fsrs leaves an interval under 2.5 days unfuzzed, so a determinism case
 * built on a new card would pass even with fuzz seeded from real randomness.
 */
const MATURE: SchedulerState = {
  due: NOW,
  stability: 40,
  difficulty: 5,
  scheduledDays: 30,
  learningSteps: 0,
  reps: 5,
  lapses: 1,
  state: 2,
  lastReview: NOW - 30 * DAY,
};

describe("Rating names the four grades a reviewer can give", () => {
  it("is the ts-fsrs grades without its Manual rating", () => {
    expectTypeOf<Rating>().toEqualTypeOf<1 | 2 | 3 | 4>();
  });
});

describe("rate schedules a card that has never been rated", () => {
  // The default learning steps are 1m and 10m: Again returns to the first
  // step, Hard sits between the two, Good advances to the second.
  const SHORT_STEPS: readonly [Rating, number][] = [
    [1, MINUTE],
    [2, 6 * MINUTE],
    [3, 10 * MINUTE],
  ];

  it.each(SHORT_STEPS)("puts rating %p %p ms out", (rating, expected) => {
    expect(rate(null, rating, NOW).after.due).toBe(NOW + expected);
  });

  it("puts Easy at least a day out, leaving the learning steps behind", () => {
    const { after } = rate(null, 4, NOW);
    expect(after.due - NOW).toBeGreaterThanOrEqual(DAY);
    expect(after.state).toBe(2);
  });

  it("reports the empty card it started from as `before`", () => {
    expect(rate(null, 3, NOW).before).toStrictEqual({
      due: NOW,
      stability: 0,
      difficulty: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      lastReview: null,
    });
  });

  it("counts the review and records when it happened", () => {
    const { after } = rate(null, 3, NOW);
    expect(after.reps).toBe(1);
    expect(after.lastReview).toBe(NOW);
    expect(after.lapses).toBe(0);
  });
});

describe("rate carries an existing card forward", () => {
  it("hands back the state it was given as `before`, unchanged", () => {
    expect(rate(MATURE, 3, NOW).before).toStrictEqual(MATURE);
  });

  it("counts a second review on top of the first", () => {
    const first = rate(null, 3, NOW).after;
    const second = rate(first, 3, NOW + 10 * MINUTE).after;
    expect(second.reps).toBe(2);
    expect(second.lastReview).toBe(NOW + 10 * MINUTE);
  });

  it("counts Again on a card in review as a lapse", () => {
    const { after } = rate(MATURE, 1, NOW);
    expect(after.lapses).toBe(MATURE.lapses + 1);
    expect(after.state).toBe(3);
  });
});

describe("rate answers the same for the same arguments", () => {
  // Fuzz is on, so this holds only because ts-fsrs seeds it from the card and
  // the review time rather than from real randomness.
  it.each([1, 2, 3, 4] as const)("repeats itself for rating %p", (rating) => {
    expect(rate(MATURE, rating, NOW)).toStrictEqual(rate(MATURE, rating, NOW));
  });

  it("repeats itself for a card that has never been rated", () => {
    expect(rate(null, 3, NOW)).toStrictEqual(rate(null, 3, NOW));
  });
});

describe("retrievability follows the FSRS forgetting curve", () => {
  const STABILITIES = [0.5, 1, 3.7, 40, 365];

  it.each(STABILITIES)("is 1 at the review itself, for stability %p", (stability) => {
    expect(retrievability(stability, NOW, NOW)).toBe(1);
  });

  it.each(STABILITIES)("is 0.9 one stability later, for %p days", (stability) => {
    const at = NOW + stability * DAY;
    expect(retrievability(stability, NOW, at)).toBeCloseTo(0.9, 6);
  });

  it("keeps falling as more time passes", () => {
    const early = retrievability(10, NOW, NOW + 5 * DAY);
    const late = retrievability(10, NOW, NOW + 50 * DAY);
    expect(late).toBeLessThan(early);
    expect(late).toBeGreaterThan(0);
  });

  it("clamps a time before the review to the review", () => {
    expect(retrievability(10, NOW, NOW - DAY)).toBe(1);
  });
});

describe("dayBounds rolls a study day over at 04:00 local", () => {
  // `[title, timeZone, now, start, end]`. Denver is -07:00 in winter and
  // -06:00 in summer; Tokyo never changes.
  const CASES: readonly [string, string, string, string, string][] = [
    [
      "03:59 still belongs to the day before",
      "America/Denver",
      "2026-06-15T09:59:00Z",
      "2026-06-14T10:00:00Z",
      "2026-06-15T10:00:00Z",
    ],
    [
      "04:00 starts the next day",
      "America/Denver",
      "2026-06-15T10:00:00Z",
      "2026-06-15T10:00:00Z",
      "2026-06-16T10:00:00Z",
    ],
    [
      "the day the clocks go forward is 23 hours long",
      "America/Denver",
      "2026-03-07T18:00:00Z",
      "2026-03-07T11:00:00Z",
      "2026-03-08T10:00:00Z",
    ],
    [
      "the day the clocks go back is 25 hours long",
      "America/Denver",
      "2026-10-31T18:00:00Z",
      "2026-10-31T10:00:00Z",
      "2026-11-01T11:00:00Z",
    ],
    [
      "a zone that never changes its offset",
      "Asia/Tokyo",
      "2026-06-15T12:00:00Z",
      "2026-06-14T19:00:00Z",
      "2026-06-15T19:00:00Z",
    ],
    [
      "a rollover that steps back over a year boundary",
      "UTC",
      "2026-01-01T03:00:00Z",
      "2025-12-31T04:00:00Z",
      "2026-01-01T04:00:00Z",
    ],
  ];

  it.each(CASES)("%s", (_title, timeZone, now, start, end) => {
    expect(dayBounds(Date.parse(now), timeZone)).toStrictEqual({
      start: Date.parse(start),
      end: Date.parse(end),
    });
  });

  it("treats its own start as inside the day and its end as outside", () => {
    const { start, end } = dayBounds(
      Date.parse("2026-03-07T18:00:00Z"),
      "America/Denver",
    );
    expect(dayBounds(start, "America/Denver").start).toBe(start);
    expect(dayBounds(end, "America/Denver").start).toBe(end);
  });

  it("falls back to the process's own time zone", () => {
    const now = Date.parse("2026-06-15T12:00:00Z");
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(dayBounds(now)).toStrictEqual(dayBounds(now, here));
  });

  it("returns a day that contains the instant it was asked about", () => {
    const now = Date.parse("2026-06-15T12:00:00Z");
    const { start, end } = dayBounds(now, "America/Denver");
    expect(start).toBeLessThanOrEqual(now);
    expect(end).toBeGreaterThan(now);
  });
});
