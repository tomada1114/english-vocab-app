import { describe, expect, expectTypeOf, it } from "vitest";

import type { Card, Level } from "../src/core/cards/card";
import {
  IELTS_SCORES,
  inScope,
  scopeSchema,
  targetLevels,
  targetSchema,
  type IeltsScore,
  type Scope,
  type Target,
} from "../src/core/scope";

// Every expected value here is written by hand from
// `.agents/skills/building-the-vocab-app/references/storage-and-scheduling.md`
// § "Scope": the IELTS → CEFR table (4.0–5.0 → B1, 5.5–6.5 → B2, 7.0–8.0 → C1,
// 8.5–9.0 → C2), "the score's CEFR level plus the one below it", the four
// conditions a card must meet, and empty `topics` meaning all.

/** A minimal card, varying only what a given test cares about. */
function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "carbon-footprint--noun",
    headword: "carbon footprint",
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

/** A scope selecting every card serving `ielts`. */
function scope(overrides: Partial<Scope> = {}): Scope {
  return { purpose: "ielts", topics: [], target: null, ...overrides };
}

/** The IELTS band `score`, as a target. */
function target(score: IeltsScore): Target {
  return { exam: "ielts", score };
}

describe("scopeSchema is the shape of a selected scope", () => {
  it("accepts a purpose with no topics and no target", () => {
    expect(
      scopeSchema.parse({ purpose: "ielts", topics: [], target: null }),
    ).toStrictEqual({ purpose: "ielts", topics: [], target: null });
  });

  it("accepts several topics alongside a target", () => {
    const selected = {
      purpose: "ielts",
      topics: ["environment", "education"],
      target: { exam: "ielts", score: 7 },
    };
    expect(scopeSchema.parse(selected)).toStrictEqual(selected);
  });

  it("rejects an unknown key rather than narrowing by a field nothing reads", () => {
    const selected = { purpose: "ielts", topics: [], target: null, level: "B2" };
    expect(scopeSchema.safeParse(selected).success).toBe(false);
  });

  it("rejects an empty purpose", () => {
    expect(scopeSchema.safeParse(scope({ purpose: "" })).success).toBe(false);
  });

  it("rejects an empty topic id", () => {
    expect(scopeSchema.safeParse(scope({ topics: [""] })).success).toBe(false);
  });

  it("rejects a purpose that is not a string", () => {
    expect(
      scopeSchema.safeParse({ purpose: 1, topics: [], target: null }).success,
    ).toBe(false);
  });
});

describe("targetSchema closes the set of IELTS bands", () => {
  it.each(IELTS_SCORES)("accepts the band %p the UI offers", (score) => {
    expect(targetSchema.parse({ exam: "ielts", score })).toStrictEqual({
      exam: "ielts",
      score,
    });
  });

  it.each([3.5, 6.25, 9.5, 0])(
    "rejects %p, which is not a half band 4.0–9.0",
    (score) => {
      expect(targetSchema.safeParse({ exam: "ielts", score }).success).toBe(false);
    },
  );

  it("rejects an exam this app has no CEFR table for", () => {
    expect(targetSchema.safeParse({ exam: "toefl", score: 7 }).success).toBe(false);
  });

  it("types the score as the bands rather than as a number", () => {
    expectTypeOf<Target["score"]>().toEqualTypeOf<IeltsScore>();
  });
});

describe("targetLevels selects the band's CEFR level and the one below", () => {
  // The four examples the issue states, verbatim.
  const EXAMPLES: readonly [IeltsScore, readonly Level[]][] = [
    [7, ["B2", "C1"]],
    [6.5, ["B1", "B2"]],
    [8.5, ["C1", "C2"]],
    [4, ["A2", "B1"]],
  ];

  it.each(EXAMPLES)("gives IELTS %p the levels %p", (score, levels) => {
    expect(targetLevels(target(score))).toStrictEqual(levels);
  });

  // The whole table, band by band, so a boundary cannot move unnoticed.
  const TABLE: readonly [IeltsScore, Level][] = [
    [4, "B1"],
    [4.5, "B1"],
    [5, "B1"],
    [5.5, "B2"],
    [6, "B2"],
    [6.5, "B2"],
    [7, "C1"],
    [7.5, "C1"],
    [8, "C1"],
    [8.5, "C2"],
    [9, "C2"],
  ];

  it.each(TABLE)(
    "reads IELTS %p as CEFR %s, the level the band names",
    (score, level) => {
      const levels = targetLevels(target(score));
      expect(levels[levels.length - 1]).toBe(level);
    },
  );

  it.each(IELTS_SCORES)("gives band %p two levels, easiest first", (score) => {
    const levels = targetLevels(target(score));
    expect(levels).toHaveLength(2);
    expect(levels[0]).not.toBe(levels[1]);
  });
});

describe("inScope decides whether a card is one the scope selects", () => {
  it("rules out a retired card that matches everything else", () => {
    expect(inScope(card({ retired: true }), scope())).toBe(false);
  });

  it("keeps an active card that matches everything", () => {
    expect(inScope(card(), scope())).toBe(true);
  });

  it("rules out a card that does not serve the scope's purpose", () => {
    expect(inScope(card({ purposes: ["toefl"] }), scope())).toBe(false);
  });

  it("keeps a card serving the purpose among several", () => {
    expect(inScope(card({ purposes: ["toefl", "ielts"] }), scope())).toBe(true);
  });

  it.each([["environment"], ["health"], ["technology"]])(
    "matches the topic %s when the scope names no topic",
    (topic) => {
      expect(inScope(card({ topics: [topic] }), scope({ topics: [] }))).toBe(true);
    },
  );

  it("matches a card sharing one topic out of several", () => {
    const selected = scope({ topics: ["health", "technology"] });
    expect(inScope(card({ topics: ["environment", "technology"] }), selected)).toBe(
      true,
    );
  });

  it("rules out a card sharing no topic with the scope", () => {
    const selected = scope({ topics: ["health"] });
    expect(inScope(card({ topics: ["environment"] }), selected)).toBe(false);
  });

  it.each(["A1", "A2", "B1", "B2", "C1", "C2"] as const)(
    "keeps a %s card when no target is set",
    (level) => {
      expect(inScope(card({ level }), scope({ target: null }))).toBe(true);
    },
  );

  it.each(["B2", "C1"] as const)(
    "keeps a %s card under an IELTS 7.0 target",
    (level) => {
      expect(inScope(card({ level }), scope({ target: target(7) }))).toBe(true);
    },
  );

  it.each(["A1", "A2", "B1", "C2"] as const)(
    "rules out a %s card under an IELTS 7.0 target",
    (level) => {
      expect(inScope(card({ level }), scope({ target: target(7) }))).toBe(false);
    },
  );
});
