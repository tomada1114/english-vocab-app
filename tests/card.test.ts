import { describe, expect, expectTypeOf, it } from "vitest";

import { cardId, cardSchema, type Card, type Pos } from "../src/core/cards/card";

// The schema and the id derivation are what every later feature reads a card
// through, so both are asserted against hand-written expectations rather than
// against anything the implementation computes. The loader that reads these
// off disk, and the committed lists, are covered by `tests/card-loader.test.ts`.

/** A card that passes, as the base every rejection case varies one field of. */
const VALID_CARD: Card = {
  id: "mitigate--verb",
  headword: "mitigate",
  pos: "verb",
  level: "C1",
  purposes: ["ielts"],
  topics: ["environment", "health"],
  definition: "to make something bad less serious or less harmful",
  cloze: "Planting trees along rivers can help ___ the effects of flooding.",
  examples: [
    "The company hired lawyers to mitigate the damage to its name.",
    "Rest and plenty of water can mitigate a mild headache.",
  ],
};

describe("cardId derives a card's id from its key", () => {
  // The first three are the worked examples in
  // `.agents/skills/building-the-vocab-app/references/card-data.md`; the rest
  // cover what its slug rule says about case, punctuation runs and trimming.
  const CASES: readonly [string, Pos, string][] = [
    ["carbon footprint", "noun", "carbon-footprint--noun"],
    ["  Well-Being ", "noun", "well-being--noun"],
    ["mitigate", "verb", "mitigate--verb"],
    ["Air   Pollution", "noun", "air-pollution--noun"],
    ["run-of-the-mill", "adjective", "run-of-the-mill--adjective"],
    ["by and large", "adverb", "by-and-large--adverb"],
  ];

  it.each(CASES)("turns %p and %p into %p", (headword, pos, expected) => {
    expect(cardId(headword, pos)).toBe(expected);
  });

  it("gives two cards with the same key the same id", () => {
    expect(cardId("Mitigate", "verb")).toBe(cardId("mitigate ", "verb"));
  });

  it("gives the same headword under two parts of speech different ids", () => {
    expect(cardId("study", "noun")).not.toBe(cardId("study", "verb"));
  });
});

describe("cardSchema accepts a card", () => {
  it("accepts one with every required field and no more", () => {
    expect(cardSchema.safeParse(VALID_CARD)).toMatchObject({ success: true });
  });

  it("returns the card unchanged, so nothing is dropped on the way in", () => {
    expect(cardSchema.parse(VALID_CARD)).toStrictEqual(VALID_CARD);
  });

  it("accepts a retired card", () => {
    const retired = { ...VALID_CARD, retired: true };
    expect(cardSchema.parse(retired)).toStrictEqual(retired);
  });

  it.each(["A1", "A2", "B1", "B2", "C1", "C2"])("accepts level %s", (level) => {
    expect(cardSchema.safeParse({ ...VALID_CARD, level })).toMatchObject({
      success: true,
    });
  });

  it.each(["noun", "verb", "adjective", "adverb"])("accepts pos %s", (pos) => {
    expect(cardSchema.safeParse({ ...VALID_CARD, pos })).toMatchObject({
      success: true,
    });
  });
});

describe("cardSchema rejects a card", () => {
  const REJECTED: readonly [string, Record<string, unknown>][] = [
    ["an unknown key", { note: "a field the schema does not declare" }],
    ["an empty definition", { definition: "" }],
    ["one example", { examples: [VALID_CARD.examples[0]] }],
    ["three examples", { examples: [...VALID_CARD.examples, "A third example."] }],
    ["a part of speech outside the closed set", { pos: "phrase" }],
    ["a level outside A1-C2", { level: "D1" }],
    ["an empty headword", { headword: "" }],
    ["an empty id", { id: "" }],
    ["an empty cloze", { cloze: "" }],
    ["no purpose", { purposes: [] }],
    ["no topic", { topics: [] }],
    ["an empty topic id", { topics: [""] }],
    ["a topic list that is not an array", { topics: "environment" }],
    ["an example that is empty", { examples: ["", VALID_CARD.examples[1]] }],
    ["retired set to false rather than omitted", { retired: false }],
    ["a numeric headword", { headword: 7 }],
  ];

  it.each(REJECTED)("rejects one with %s", (_label, overrides) => {
    expect(cardSchema.safeParse({ ...VALID_CARD, ...overrides })).toMatchObject({
      success: false,
    });
  });

  it("rejects one missing a required field", () => {
    const withoutDefinition = Object.fromEntries(
      Object.entries(VALID_CARD).filter(([field]) => field !== "definition"),
    );
    expect(cardSchema.safeParse(withoutDefinition)).toMatchObject({ success: false });
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a bare string", "mitigate"],
  ])("rejects %s, which is not an object at all", (_label, value) => {
    expect(cardSchema.safeParse(value)).toMatchObject({ success: false });
  });
});

describe("the Card type the schema infers", () => {
  it("keeps examples a pair, so a card cannot carry one or three", () => {
    expectTypeOf<Card["examples"]>().toEqualTypeOf<[string, string]>();
  });

  it("keeps pos and level closed unions rather than strings", () => {
    expectTypeOf<Card["pos"]>().toEqualTypeOf<Pos>();
    expectTypeOf<Card["level"]>().toEqualTypeOf<
      "A1" | "A2" | "B1" | "B2" | "C1" | "C2"
    >();
  });

  it("makes retired optional and true when present", () => {
    expectTypeOf<Card["retired"]>().toEqualTypeOf<true | undefined>();
  });
});
