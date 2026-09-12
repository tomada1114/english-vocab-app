import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { cardSchema } from "../src/core/cards/card";
import { lintCards } from "../src/core/cards/lint";
import { loadLists } from "../src/server/cards";

// The card pipeline skills are prompts, not code: `reviewing-cards` is pasted
// into an independent run and its answer is parsed by the calling session. So
// the parts a caller depends on — the placeholders the prompt template is fed
// through, the criteria a run is handed in full, and the shape of the JSON that
// comes back — are asserted here. `pnpm agents:check` only proves the mirror
// matches, and `tests/skills-frontmatter.test.ts` only reads frontmatter;
// neither would notice a criterion that lost its text or an example output that
// stopped matching the shape the skill documents.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const skillRoot = path.join(repoRoot, ".agents", "skills", "reviewing-cards");
const generatingSkillRoot = path.join(
  repoRoot,
  ".agents",
  "skills",
  "generating-cards",
);
const dataDirectory = path.join(repoRoot, "data");
const workedExampleFixture = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "cards",
  "resilience--noun.json",
);

function readSkillFile(relative: string): string {
  return readFileSync(path.join(skillRoot, relative), "utf8");
}

const skill = readSkillFile("SKILL.md");
const blindAnswer = readSkillFile(path.join("references", "blind-answer.md"));
const perspectiveReview = readSkillFile(
  path.join("references", "perspective-review.md"),
);
const generatingSkill = readFileSync(
  path.join(generatingSkillRoot, "SKILL.md"),
  "utf8",
);
const cardRules = readFileSync(
  path.join(generatingSkillRoot, "references", "card-rules.md"),
  "utf8",
);

// --- markdown scanning -------------------------------------------------------

interface FencedBlock {
  /** The info string after the opening fence, e.g. `json`. */
  info: string;
  /** Everything between the fences, without the fence lines themselves. */
  body: string;
}

/**
 * Split a markdown document into its fenced code blocks.
 *
 * @param {string} source - The full contents of a markdown file.
 * @returns {FencedBlock[]} Every fenced block, in document order.
 * @throws {Error} When a block is opened and never closed.
 */
function fencedBlocks(source: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  let info: string | undefined;
  let lines: string[] = [];

  for (const line of source.split("\n")) {
    if (!line.startsWith("```")) {
      if (info !== undefined) lines.push(line);
      continue;
    }
    if (info === undefined) {
      info = line.slice(3).trim();
      lines = [];
      continue;
    }
    blocks.push({ info, body: lines.join("\n") });
    info = undefined;
  }
  if (info !== undefined) throw new Error("a fenced code block is never closed");
  return blocks;
}

interface Section {
  title: string;
  body: string;
}

/**
 * Collect the sections a markdown document opens at one heading level.
 *
 * A section ends at the next heading of any level, so a criterion's text is
 * never padded with whatever follows the group it sits in. Headings inside a
 * fenced block are ignored.
 *
 * @param {string} source - The full contents of a markdown file.
 * @param {number} level - The heading depth to collect, e.g. 3 for `###`.
 * @returns {Section[]} Each heading's title and the text under it.
 */
function sectionsAtLevel(source: string, level: number): Section[] {
  const sections: Section[] = [];
  let current: Section | undefined;
  let fenced = false;

  for (const line of source.split("\n")) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      if (current !== undefined) current.body += `${line}\n`;
      continue;
    }
    const heading = fenced ? null : /^(#{1,6}) +(.*)$/u.exec(line);
    if (heading !== null) {
      if (current !== undefined) {
        sections.push(current);
        current = undefined;
      }
      if ((heading[1] ?? "").length === level) {
        current = { title: (heading[2] ?? "").trim(), body: "" };
      }
      continue;
    }
    if (current !== undefined) current.body += `${line}\n`;
  }
  if (current !== undefined) sections.push(current);
  return sections;
}

// --- the documented output shape ---------------------------------------------

const TOP_LEVEL_KEYS: readonly string[] = ["lens", "findings", "answers"];
const LENSES: readonly string[] = ["blind-answer", "perspective-review"];
const REQUIRED_FINDING_KEYS: readonly string[] = [
  "id",
  "verdict",
  "confidence",
  "reason",
];
const SUGGESTION_KEYS: readonly string[] = [
  "suggest_definition",
  "suggest_cloze",
  "suggest_examples",
];
const CONFIDENCES: readonly string[] = ["high", "medium", "low"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Report every way one finding departs from the shape SKILL.md documents.
 *
 * @param {unknown} finding - One entry of a run's `findings` array.
 * @param {string} where - How to name this entry in a failure message.
 * @returns {string[]} One sentence per departure; empty when the entry is valid.
 */
function findingProblems(finding: unknown, where: string): string[] {
  if (!isRecord(finding)) return [`${where} is not a JSON object`];
  const problems: string[] = [];

  for (const key of REQUIRED_FINDING_KEYS) {
    const value = finding[key];
    if (typeof value !== "string" || value === "") {
      problems.push(`${where} has no "${key}" string`);
    }
  }
  for (const key of Object.keys(finding)) {
    if (!REQUIRED_FINDING_KEYS.includes(key) && !SUGGESTION_KEYS.includes(key)) {
      problems.push(`${where} carries the undocumented key "${key}"`);
    }
  }

  const id = finding["id"];
  if (typeof id !== "string" || !/^c\d+$/u.test(id)) {
    problems.push(`${where} is labelled ${JSON.stringify(id)} rather than c1 ... cN`);
  }
  const confidence = finding["confidence"];
  if (typeof confidence !== "string" || !CONFIDENCES.includes(confidence)) {
    problems.push(`${where} has no confidence of ${CONFIDENCES.join(", ")}`);
  }

  const suggested = SUGGESTION_KEYS.filter((key) => key in finding);
  const verdict = finding["verdict"];
  if (verdict === "FIX" && suggested.length !== SUGGESTION_KEYS.length) {
    problems.push(`${where} is a FIX that omits a suggest_* key`);
  } else if (verdict === "DROP" && suggested.length > 0) {
    problems.push(`${where} is a DROP carrying ${suggested.join(", ")}`);
  } else if (verdict !== "FIX" && verdict !== "DROP") {
    problems.push(`${where} has the verdict ${JSON.stringify(verdict)}`);
  }
  return problems;
}

/**
 * Report every way one run's output departs from the shape SKILL.md documents.
 *
 * @param {unknown} output - A parsed JSON example from SKILL.md.
 * @returns {string[]} One sentence per departure; empty when it is valid.
 */
function outputProblems(output: unknown): string[] {
  if (!isRecord(output)) return ["the example is not a JSON object"];
  const problems: string[] = [];

  const lens = output["lens"];
  if (typeof lens !== "string" || !LENSES.includes(lens)) {
    problems.push(`the example names the lens ${JSON.stringify(lens)}`);
  }
  for (const key of Object.keys(output)) {
    if (!TOP_LEVEL_KEYS.includes(key)) {
      problems.push(`the example carries the undocumented top-level key "${key}"`);
    }
  }
  if ("answers" in output && lens !== "blind-answer") {
    problems.push(`only a blind-answer run returns "answers"`);
  }
  if ("answers" in output) {
    const answers = output["answers"];
    if (!isArray(answers) || answers.length === 0) {
      problems.push(`"answers" is not a non-empty array`);
    } else {
      answers.forEach((answer, index) => {
        const words = isRecord(answer) ? answer["words"] : undefined;
        if (!isRecord(answer) || typeof answer["id"] !== "string" || !isArray(words)) {
          problems.push(`answers[${String(index)}] is not an id with a word list`);
        }
      });
    }
  }

  const findings = output["findings"];
  if (!isArray(findings)) return [...problems, `"findings" is not an array`];
  findings.forEach((finding, index) => {
    problems.push(...findingProblems(finding, `findings[${String(index)}]`));
  });
  return problems;
}

/** Every verdict named by a parsed example, in document order. */
function verdictsOf(output: unknown): string[] {
  if (!isRecord(output)) return [];
  const findings = output["findings"];
  if (!isArray(findings)) return [];
  return findings.flatMap((finding) => {
    const verdict = isRecord(finding) ? finding["verdict"] : undefined;
    return typeof verdict === "string" ? [verdict] : [];
  });
}

// --- the assertions -----------------------------------------------------------

describe("the generating-cards skill", () => {
  it("links its rules and the independent review", () => {
    expect(generatingSkill).toContain("[card-rules.md](references/card-rules.md)");
    expect(generatingSkill).toContain("reviewing-cards");
    expect(generatingSkill).toContain("pnpm cards:lint");
  });

  it("gives each adapted rule exactly one level-two section", () => {
    expect(sectionsAtLevel(cardRules, 2).map(({ title }) => title)).toEqual([
      "C1. Keep the card shape",
      "C2. Make the front answerable",
      "C3. Keep wording readable",
      "C4. Use the headword in examples",
      "C5. Ground the word in the target",
      "C6. Keep one key per sense",
      "C7. Keep the back honest",
      "C8. Give every example a different context",
    ]);
  });

  it("keeps the worked JSON example equal to a fixture with a clean Lint", async () => {
    const examples = fencedBlocks(cardRules).filter(
      (candidate) => candidate.info === "json",
    );
    expect(examples).toHaveLength(1);
    const [block] = examples;
    expect(block).toBeDefined();
    const documented = JSON.parse(block?.body ?? "null") as unknown;
    const fixture = JSON.parse(readFileSync(workedExampleFixture, "utf8")) as unknown;
    expect(documented).toEqual(fixture);

    const card = cardSchema.parse(fixture);
    const lists = await loadLists(dataDirectory);
    expect(lintCards([{ fileName: `${card.id}.json`, card }], lists)).toEqual([]);
  });
});

describe("the reviewing-cards SKILL.md", () => {
  it("links both reference files", () => {
    expect(skill).toContain("(references/blind-answer.md)");
    expect(skill).toContain("(references/perspective-review.md)");
  });

  it("works one FIX example and one DROP example", () => {
    const examples = fencedBlocks(skill).filter((block) => block.info === "json");
    expect(examples).toHaveLength(2);
    const parsed = examples.map((example) => JSON.parse(example.body) as unknown);
    expect(parsed.flatMap(verdictsOf).sort()).toEqual(["DROP", "FIX"]);
  });

  it("matches its own documented output shape in both examples", () => {
    const parsed = fencedBlocks(skill)
      .filter((block) => block.info === "json")
      .map((example) => JSON.parse(example.body) as unknown);
    expect(parsed.flatMap(outputProblems)).toEqual([]);
  });
});

describe("the blind-answer reference", () => {
  it("carries exactly one prompt template", () => {
    expect(
      fencedBlocks(blindAnswer).filter((block) => block.info === "text"),
    ).toHaveLength(1);
  });

  it("feeds the template only the definition and the cloze", () => {
    // The lens is the answer being hidden. A third placeholder — the headword,
    // the examples that use it, or the card id it is derived from — would hand
    // the run the very thing it must not see, and the review would pass every
    // front it is given.
    const [template] = fencedBlocks(blindAnswer).filter(
      (block) => block.info === "text",
    );
    const placeholders = template?.body.match(/<[^<>\n]*>/gu) ?? [];
    expect(placeholders).toEqual(["<definition>", "<cloze>"]);
  });
});

describe("the perspective-review reference", () => {
  // A run is handed the criterion text, never its name, so a heading whose text
  // went missing is a criterion that silently stops being reviewed.
  const CRITERIA = [
    "Answer leak by paraphrase",
    "Example quality",
    "Disguised echo",
    "Overlapping examples",
    "Duplicate synonym",
  ];
  const criteria = sectionsAtLevel(perspectiveReview, 3);

  it("gives each criterion one heading, and no others", () => {
    expect(criteria.map((section) => section.title)).toEqual(CRITERIA);
  });

  it.each(CRITERIA)("states %s in full under its heading", (title) => {
    const section = criteria.find((candidate) => candidate.title === title);
    expect(section?.body.trim().length ?? 0).toBeGreaterThan(300);
  });
});
