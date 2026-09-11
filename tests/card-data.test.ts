import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { LINT_RULES, type LintFinding } from "../src/core/cards/lint";
import { severityOf } from "../src/core/cards/lint-finding";
import { formatFinding, lintDataDirectory } from "../src/server/card-lint";

// This is the gate `pnpm cards:lint` runs and `pnpm test` runs with everything
// else: it points the Lint at the committed `data/` tree, fails on any ERROR
// and prints every WARN, so a pull request adding a bad card goes red here
// rather than on the first page that asks for the card. It joins the
// `automation` project for the usual reason — it reads the real tree and
// writes temp directories.
//
// The rules themselves are driven over cards built in memory by
// `tests/card-lint.test.ts`. What is asserted here is everything that only a
// real directory shows: a file the loader could not read at all, the report a
// failure prints, and the rule table in the reference staying the rule list in
// the code.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const dataDirectory = path.join(repoRoot, "data");
const reference = path.join(
  repoRoot,
  ".agents",
  "skills",
  "building-the-vocab-app",
  "references",
  "card-data.md",
);

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

/** A card that breaks no rule, as each fixture varies one field of. */
const VALID_CARD = {
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

/** A second card that breaks no rule, for the cases that need two files. */
const ALLEVIATE_CARD = {
  ...VALID_CARD,
  id: "alleviate--verb",
  headword: "alleviate",
  definition: "to make pain or a problem less bad",
  cloze: "A short rest can ___ the worst of the pain.",
  examples: ["Aspirin alleviates most headaches.", "Rain alleviated the drought."],
};

/**
 * A data directory holding `files` under `cards/`, beside the real lists.
 *
 * @remarks
 * The committed `data/topics.json` and `data/purposes.json` are copied rather
 * than invented, so a fixture is tagged the way a real card is. A string value
 * is written as it stands, which is how a file that is not a card at all gets
 * into the tree.
 */
function dataDirectoryWith(files: Record<string, unknown>): string {
  const directory = mkdtempSync(path.join(tmpdir(), "card-data-"));
  temporaryDirectories.push(directory);
  mkdirSync(path.join(directory, "cards"));
  for (const list of ["topics.json", "purposes.json"]) {
    copyFileSync(path.join(dataDirectory, list), path.join(directory, list));
  }
  for (const [name, content] of Object.entries(files)) {
    const text = typeof content === "string" ? content : JSON.stringify(content);
    writeFileSync(path.join(directory, "cards", name), text);
  }
  return directory;
}

/** The findings of one report, as `file — rule — message` lines. */
function report(findings: readonly LintFinding[], severity: "ERROR" | "WARN"): string {
  return findings
    .filter((finding) => finding.severity === severity)
    .map(formatFinding)
    .join("\n");
}

describe("the committed data/ tree", () => {
  // Every WARN is attached to the test as an annotation rather than printed:
  // the reporter shows it whether the run is green or red, and `no-console`
  // covers `tests/**` the same way it covers `src/**`.
  it("breaks no rule, so CI blocks a pull request that adds a bad card", async ({
    annotate,
  }) => {
    const findings = await lintDataDirectory(dataDirectory);
    for (const warning of findings.filter((finding) => finding.severity === "WARN")) {
      await annotate(formatFinding(warning), "warning");
    }
    expect(report(findings, "ERROR")).toBe("");
  });
});

describe("the rule table in card-data.md", () => {
  /** Every `| \`RULE\` | SEVERITY |` row of the reference's Lint table. */
  const rows = [
    ...readFileSync(reference, "utf8").matchAll(/^\|\s*`([EW]_\w+)`\s*\|\s*(\w+)/gm),
  ];

  it("lists exactly the rules the Lint reports, in the same order", () => {
    expect(rows.map((row) => row[1])).toStrictEqual([...LINT_RULES]);
  });

  it("gives each rule the severity the rule id carries", () => {
    const documented = rows.map((row) => [row[1], row[2]]);
    expect(documented).toStrictEqual(
      LINT_RULES.map((rule) => [rule, severityOf(rule)]),
    );
  });
});

describe("lintDataDirectory over a directory of valid cards", () => {
  it("reports nothing at all", async () => {
    const directory = dataDirectoryWith({
      "mitigate--verb.json": VALID_CARD,
      "alleviate--verb.json": ALLEVIATE_CARD,
    });
    expect(await lintDataDirectory(directory)).toStrictEqual([]);
  });
});

describe("lintDataDirectory over a directory holding one failing card", () => {
  it("reports the ERROR against the file it came from", async () => {
    const directory = dataDirectoryWith({
      "mitigate--verb.json": VALID_CARD,
      "alleviate--verb.json": { ...ALLEVIATE_CARD, topics: ["space"] },
    });
    const findings = await lintDataDirectory(directory);
    expect(
      findings.map(({ severity, rule, file }) => ({ severity, rule, file })),
    ).toStrictEqual([
      { severity: "ERROR", rule: "E_UNKNOWN_TOPIC", file: "alleviate--verb.json" },
    ]);
  });

  it("prints the failure as `file — rule — message`", async () => {
    const directory = dataDirectoryWith({
      "mitigate--verb.json": { ...VALID_CARD, topics: ["space"] },
    });
    const findings = await lintDataDirectory(directory);
    expect(report(findings, "ERROR")).toBe(
      'mitigate--verb.json — E_UNKNOWN_TOPIC — topic "space" is not in data/topics.json.',
    );
  });

  it("reports a file the loader could not read as a card at all", async () => {
    const directory = dataDirectoryWith({ "mitigate--verb.json": "{ not json" });
    const findings = await lintDataDirectory(directory);
    expect(findings.map(({ rule, file }) => ({ rule, file }))).toStrictEqual([
      { rule: "E_SCHEMA", file: "mitigate--verb.json" },
    ]);
  });

  it("reports a card filed under the wrong name as E_ID_MISMATCH", async () => {
    const directory = dataDirectoryWith({ "misfiled--verb.json": VALID_CARD });
    const findings = await lintDataDirectory(directory);
    expect(findings.map(({ rule, file }) => ({ rule, file }))).toStrictEqual([
      { rule: "E_ID_MISMATCH", file: "misfiled--verb.json" },
    ]);
  });

  it("passes a WARN through without turning it into a failure", async ({
    annotate,
  }) => {
    const directory = dataDirectoryWith({
      "mitigate--verb.json": {
        ...VALID_CARD,
        examples: [
          "Rest and plenty of water can mitigate a mild headache.",
          "Rest can mitigate a headache.",
        ],
      },
    });
    const findings = await lintDataDirectory(directory);
    const warnings = report(findings, "WARN");
    // The same annotation the committed tree's WARNs go through above, over a
    // fixture that really has one, so the reporting path is exercised while
    // `data/cards/` is still empty.
    await annotate(warnings, "warning");
    expect(report(findings, "ERROR")).toBe("");
    expect(warnings).toContain("mitigate--verb.json — W_EXAMPLE_LONGISH —");
  });
});
