import { describe, expect, it } from "vitest";

import type { Card } from "../src/core/cards/card";
import {
  lintCards,
  type LintFinding,
  type LintLists,
  type LintRule,
} from "../src/core/cards/lint";
import {
  ECHO_MIN_FRAGMENT_LEN,
  MAX_CLOZE_WORDS,
  MAX_EXAMPLE_WORDS,
  MAX_FRONT_WORDS,
  MAX_HEADWORD_WORDS,
  RECOMMENDED_EXAMPLE_WORDS,
} from "../src/core/cards/lint-config";

// The Lint is driven here over cards built in the test rather than over files:
// `lintCards` takes cards, and a fixture tree would only add a loader between
// a rule and the case that is meant to fire it. What the Lint does with a real
// directory — the loader's own failures, the report, the committed `data/` —
// is `tests/card-data.test.ts`, which is where the disk is.
//
// Every rule in the table in
// `.agents/skills/building-the-vocab-app/references/card-data.md` has a case
// that fires it and a case that does not. Every threshold case reads the limit
// from `lint-config.ts`, so a changed threshold moves the test with it instead
// of leaving a stale number behind.

const LISTS: LintLists = {
  topics: ["environment", "health"],
  purposes: [{ id: "ielts", label: "IELTS" }],
};

/**
 * A card that breaks no rule, as the base every case varies one field of.
 *
 * @remarks
 * Deliberately not the worked example in `card-data.md`: that card's first
 * example runs to 11 words, which is a `W_EXAMPLE_LONGISH` this base must not
 * carry if "the base reports nothing" is to mean anything.
 */
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
    "Lawyers were hired to mitigate the damage.",
    "Rest can mitigate a headache.",
  ],
};

/** Japanese text, as a field that must not carry any would hold it. */
const CJK_TEXT = "対策";

/** `VALID_CARD` with `overrides` applied, still a complete card. */
function cardWith(overrides: Partial<Card>): Card {
  return { ...VALID_CARD, ...overrides };
}

/** Everything the Lint says about one card, filed under its own id. */
function lintOne(overrides: Partial<Card> = {}, fileName?: string): LintFinding[] {
  const card = cardWith(overrides);
  return lintCards([{ fileName: fileName ?? `${card.id}.json`, card }], LISTS);
}

/** The rules one card breaks, in the order the Lint reports them. */
function rulesFor(overrides: Partial<Card> = {}, fileName?: string): LintRule[] {
  return lintOne(overrides, fileName).map((finding) => finding.rule);
}

/** `count` words of filler, which no rule but a length rule reads. */
function words(count: number): string {
  return Array.from({ length: count }, () => "alpha").join(" ");
}

describe("lintCards over a card that breaks no rule", () => {
  it("reports nothing at all", () => {
    expect(lintOne()).toStrictEqual([]);
  });

  it("reports nothing for a retired card either", () => {
    expect(lintOne({ retired: true })).toStrictEqual([]);
  });

  it("reports nothing for an empty directory", () => {
    expect(lintCards([], LISTS)).toStrictEqual([]);
  });
});

describe("a finding", () => {
  const [finding] = lintOne({ topics: ["space"] });

  it("names the file it is about", () => {
    expect(finding?.file).toBe("mitigate--verb.json");
  });

  it("takes its severity from the rule id, so the two cannot disagree", () => {
    expect(finding?.severity).toBe("ERROR");
    const longer = "Rest and plenty of water can mitigate a mild headache.";
    expect(lintOne({ examples: [VALID_CARD.examples[0], longer] })[0]).toMatchObject({
      severity: "WARN",
      rule: "W_EXAMPLE_LONGISH",
    });
  });

  it("carries a message naming what is wrong", () => {
    expect(finding?.message).toContain("space");
  });
});

describe("E_SCHEMA, what the zod schema cannot see", () => {
  it("fires for a field that is whitespace rather than text", () => {
    expect(rulesFor({ definition: "   " })).toContain("E_SCHEMA");
  });

  it("does not fire for a field holding text", () => {
    expect(rulesFor()).not.toContain("E_SCHEMA");
  });
});

describe("E_ID_MISMATCH", () => {
  it("fires for an id that is not the one the key derives", () => {
    expect(rulesFor({ id: "mitigation--verb" }, "mitigation--verb.json")).toContain(
      "E_ID_MISMATCH",
    );
  });

  it("fires for a file name that is not the id the card declares", () => {
    expect(rulesFor({}, "mitigate.json")).toContain("E_ID_MISMATCH");
  });

  it("does not fire when the id, the key and the file name agree", () => {
    expect(rulesFor()).not.toContain("E_ID_MISMATCH");
  });
});

describe("E_DUPLICATE_KEY", () => {
  /** Two files whose cards are built from the same base. */
  function lintPair(second: Partial<Card>): LintRule[] {
    const cards = [cardWith({}), cardWith(second)];
    return lintCards(
      cards.map((card, index) => ({ fileName: `card-${String(index)}.json`, card })),
      LISTS,
    )
      .filter((finding) => finding.rule === "E_DUPLICATE_KEY")
      .map((finding) => finding.rule);
  }

  it("fires for a second file carrying the same headword and pos", () => {
    expect(lintPair({})).toStrictEqual(["E_DUPLICATE_KEY"]);
  });

  it("fires when the second card is retired, because a key stays reserved", () => {
    expect(lintPair({ retired: true })).toStrictEqual(["E_DUPLICATE_KEY"]);
  });

  it("does not fire for two cards with different keys", () => {
    expect(lintPair({ headword: "alleviate", id: "alleviate--verb" })).toStrictEqual(
      [],
    );
  });
});

describe("E_UNKNOWN_TOPIC and E_UNKNOWN_PURPOSE", () => {
  it("fire for a tag that is not in the committed list", () => {
    expect(rulesFor({ topics: ["space"] })).toContain("E_UNKNOWN_TOPIC");
    expect(rulesFor({ purposes: ["toefl"] })).toContain("E_UNKNOWN_PURPOSE");
  });

  it("do not fire for the tags the lists carry", () => {
    expect(rulesFor()).not.toContain("E_UNKNOWN_TOPIC");
    expect(rulesFor()).not.toContain("E_UNKNOWN_PURPOSE");
  });

  it("fire once per unknown tag rather than once per card", () => {
    expect(rulesFor({ topics: ["space", "weather"] })).toStrictEqual([
      "E_UNKNOWN_TOPIC",
      "E_UNKNOWN_TOPIC",
    ]);
  });
});

describe("E_FORBIDDEN_MARK", () => {
  it.each([
    ["three dots", "to make something bad less serious..."],
    ["an ellipsis character", "to make something bad less serious…"],
  ])("fires for %s in a field", (_name, definition) => {
    expect(rulesFor({ definition })).toContain("E_FORBIDDEN_MARK");
  });

  it("fires for a mark in an example too, not only on the front", () => {
    expect(
      rulesFor({ examples: ["Rest can mitigate...", "Rest can mitigate a headache."] }),
    ).toContain("E_FORBIDDEN_MARK");
  });

  it("does not fire for a card carrying neither mark", () => {
    expect(rulesFor()).not.toContain("E_FORBIDDEN_MARK");
  });
});

describe("E_HAS_CJK", () => {
  it.each([
    ["headword", { headword: CJK_TEXT, id: `${CJK_TEXT}--verb` }],
    ["definition", { definition: CJK_TEXT }],
    ["cloze", { cloze: `${CJK_TEXT} ___.` }],
    [
      "an example",
      { examples: [CJK_TEXT, "Rest can mitigate a headache."] as [string, string] },
    ],
    ["a topic", { topics: [CJK_TEXT] }],
  ])("fires for CJK text in %s", (_field, overrides) => {
    expect(rulesFor(overrides)).toContain("E_HAS_CJK");
  });

  it("does not fire for a card that is English throughout", () => {
    expect(rulesFor()).not.toContain("E_HAS_CJK");
  });
});

describe("E_CLOZE_BLANK", () => {
  it.each([
    ["no blank at all", "Planting trees along rivers helps."],
    ["two blanks", "Planting ___ helps ___ the flooding."],
    ["a blank of the wrong width", "Planting trees can help __ the flooding."],
  ])("fires for a cloze with %s", (_name, cloze) => {
    expect(rulesFor({ cloze })).toContain("E_CLOZE_BLANK");
  });

  it("does not fire for a cloze holding exactly one blank", () => {
    expect(rulesFor()).not.toContain("E_CLOZE_BLANK");
  });
});

describe("E_ANSWER_LEAK", () => {
  it("fires for an inflection of the headword in the cloze", () => {
    const cloze = "Planting trees mitigated the effects of ___ flooding.";
    expect(rulesFor({ cloze })).toContain("E_ANSWER_LEAK");
  });

  it("fires for the headword itself in the definition", () => {
    expect(rulesFor({ definition: "to mitigate something bad" })).toContain(
      "E_ANSWER_LEAK",
    );
  });

  it("does not fire for a front that only defines the word", () => {
    expect(rulesFor()).not.toContain("E_ANSWER_LEAK");
  });

  it("does not fire when a multi-word headword shares one ordinary word", () => {
    const rules = rulesFor({
      headword: "side job",
      id: "side-job--noun",
      pos: "noun",
      definition: "a job you do at the weekend for extra money",
      cloze: "She waits tables as a ___ on Saturdays.",
      examples: ["His side job pays the rent.", "A side job funded the trip."],
    });
    expect(rules).not.toContain("E_ANSWER_LEAK");
  });
});

describe("E_EXAMPLE_MISSING_ANSWER", () => {
  /** The rules one example breaks for a card whose headword is `headword`. */
  function rulesForExample(headword: string, example: string): LintRule[] {
    return rulesFor({
      headword,
      id: `${headword}--verb`,
      definition: "to do the thing this card is about",
      cloze: "The team decided to ___ it after lunch.",
      examples: [example, example],
    });
  }

  it("fires for an example that never uses the headword", () => {
    expect(rulesForExample("mitigate", "Rest and water help a headache.")).toContain(
      "E_EXAMPLE_MISSING_ANSWER",
    );
  });

  it("accepts an irregular past form, so `threw` uses `throw`", () => {
    expect(rulesForExample("throw", "He threw the ball over the fence.")).not.toContain(
      "E_EXAMPLE_MISSING_ANSWER",
    );
  });

  it("accepts a doubled consonant, so `rubbed` uses `rub`", () => {
    expect(rulesForExample("rub", "She rubbed the table clean.")).not.toContain(
      "E_EXAMPLE_MISSING_ANSWER",
    );
  });

  it("accepts a dropped `e`, so `joking` uses `joke`", () => {
    expect(rulesForExample("joke", "He was joking about the delay.")).not.toContain(
      "E_EXAMPLE_MISSING_ANSWER",
    );
  });

  it("is not satisfied by a prefix, so `over` does not use `oversee`", () => {
    expect(rulesForExample("oversee", "She watches over the whole team.")).toContain(
      "E_EXAMPLE_MISSING_ANSWER",
    );
  });

  it("ignores a placeholder word, which an example replaces with a real object", () => {
    expect(
      rulesForExample("throw something out", "She threw the broken chair out."),
    ).not.toContain("E_EXAMPLE_MISSING_ANSWER");
  });

  it("does not fire for the base card, whose examples both use the word", () => {
    expect(rulesFor()).not.toContain("E_EXAMPLE_MISSING_ANSWER");
  });
});

describe("W_EXAMPLE_PARTIAL_ANSWER", () => {
  /** A card whose headword is two words, with `examples` on the back. */
  function rulesForPhrase(examples: [string, string]): LintRule[] {
    return rulesFor({
      headword: "carbon footprint",
      id: "carbon-footprint--noun",
      pos: "noun",
      definition: "the amount of harmful gas a person or a company puts out",
      cloze: "Flying less is the fastest way to cut your ___.",
      examples,
    });
  }

  it("fires for an example using only part of a multi-word headword", () => {
    const rules = rulesForPhrase([
      "The carbon in the air keeps rising.",
      "Her carbon footprint fell last year.",
    ]);
    expect(rules).toContain("W_EXAMPLE_PARTIAL_ANSWER");
  });

  it("does not fire when both examples use the whole headword", () => {
    const rules = rulesForPhrase([
      "Her carbon footprint fell last year.",
      "A small carbon footprint is the goal.",
    ]);
    expect(rules).not.toContain("W_EXAMPLE_PARTIAL_ANSWER");
  });
});

describe("E_EXAMPLE_ECHOES_CLOZE", () => {
  it("fires for an example that is the cloze with its blank filled in", () => {
    const echo =
      "Planting trees along rivers can help mitigate the effects of flooding.";
    expect(rulesFor({ examples: [echo, "Rest can mitigate a headache."] })).toContain(
      "E_EXAMPLE_ECHOES_CLOZE",
    );
  });

  it("does not fire for examples set in another scene", () => {
    expect(rulesFor()).not.toContain("E_EXAMPLE_ECHOES_CLOZE");
  });

  it("compares a fragment of the length lint-config sets, and not a shorter one", () => {
    const fragment = "a".repeat(ECHO_MIN_FRAGMENT_LEN);
    const shorter = "a".repeat(ECHO_MIN_FRAGMENT_LEN - 1);
    const example = `${fragment} mitigate today.`;
    const examples: [string, string] = [example, "Rest can mitigate a headache."];
    expect(rulesFor({ cloze: `${fragment} ___.`, examples })).toContain(
      "E_EXAMPLE_ECHOES_CLOZE",
    );
    expect(rulesFor({ cloze: `${shorter} ___.`, examples })).not.toContain(
      "E_EXAMPLE_ECHOES_CLOZE",
    );
  });
});

describe("E_EXAMPLES_IDENTICAL", () => {
  it("fires for two examples holding the same sentence", () => {
    const example = "Rest can mitigate a headache.";
    expect(rulesFor({ examples: [example, example] })).toContain(
      "E_EXAMPLES_IDENTICAL",
    );
  });

  it("fires for two that differ only in punctuation and case", () => {
    const examples: [string, string] = [
      "Rest can mitigate a headache.",
      "rest can mitigate a headache!",
    ];
    expect(rulesFor({ examples })).toContain("E_EXAMPLES_IDENTICAL");
  });

  it("does not fire for two different sentences", () => {
    expect(rulesFor()).not.toContain("E_EXAMPLES_IDENTICAL");
  });
});

describe("the length rules, at the limits lint-config sets", () => {
  /** Only the rules `card` breaks that are about length. */
  function lengthRules(overrides: Partial<Card>): LintRule[] {
    return rulesFor(overrides).filter((rule) => rule.endsWith("_TOO_LONG"));
  }

  const cloze = `${words(MAX_CLOZE_WORDS - 1)} ___.`;

  it("accepts a front of exactly the limit and rejects one word more", () => {
    const definition = words(MAX_FRONT_WORDS - MAX_CLOZE_WORDS);
    expect(lengthRules({ definition, cloze })).not.toContain("E_FRONT_TOO_LONG");
    expect(lengthRules({ definition: `${definition} alpha`, cloze })).toContain(
      "E_FRONT_TOO_LONG",
    );
  });

  it("accepts a cloze of exactly the limit and rejects one word more", () => {
    const definition = "short";
    expect(lengthRules({ definition, cloze })).not.toContain("E_CLOZE_TOO_LONG");
    expect(lengthRules({ definition, cloze: `alpha ${cloze}` })).toContain(
      "E_CLOZE_TOO_LONG",
    );
  });

  it("accepts a headword of exactly the limit and rejects one word more", () => {
    const headword = words(MAX_HEADWORD_WORDS);
    expect(lengthRules({ headword })).not.toContain("E_HEADWORD_TOO_LONG");
    expect(lengthRules({ headword: `${headword} alpha` })).toContain(
      "E_HEADWORD_TOO_LONG",
    );
  });

  it("accepts an example of exactly the limit and rejects one word more", () => {
    const example = words(MAX_EXAMPLE_WORDS);
    const longer = words(MAX_EXAMPLE_WORDS + 1);
    expect(lengthRules({ examples: [example, "beta"] })).not.toContain(
      "E_EXAMPLE_TOO_LONG",
    );
    expect(lengthRules({ examples: [longer, "beta"] })).toContain("E_EXAMPLE_TOO_LONG");
  });
});

describe("W_EXAMPLE_LONGISH", () => {
  /** Only the warnings `card` collects about the length of an example. */
  function longish(count: number): LintRule[] {
    const examples: [string, string] = [words(count), "beta"];
    return rulesFor({ examples }).filter((rule) => rule === "W_EXAMPLE_LONGISH");
  }

  it("does not fire at exactly the recommended length", () => {
    expect(longish(RECOMMENDED_EXAMPLE_WORDS)).toStrictEqual([]);
  });

  it("fires one word past it", () => {
    expect(longish(RECOMMENDED_EXAMPLE_WORDS + 1)).toStrictEqual(["W_EXAMPLE_LONGISH"]);
  });

  it("gives way to the error once the example is over the hard limit", () => {
    expect(longish(MAX_EXAMPLE_WORDS + 1)).toStrictEqual([]);
  });
});
