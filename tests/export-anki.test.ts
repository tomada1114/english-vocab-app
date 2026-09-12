import consoleModule from "node:console";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "../scripts/export-anki.mjs";

const temporaryDirectories: string[] = [];
const ANKI_HEADERS = "#separator:tab\n#html:true\n#tags column:3\n";

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

/** A fresh repository-shaped root removed after the test that uses it. */
function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vocab-anki-"));
  mkdirSync(path.join(root, "data", "cards"), { recursive: true });
  temporaryDirectories.push(root);
  return root;
}

/** Write a card fixture without coupling the test to the parser's internals. */
function writeCard(root: string, name: string, card: Record<string, unknown>): void {
  writeFileSync(
    path.join(root, "data", "cards", name),
    `${JSON.stringify(card)}\n`,
    "utf8",
  );
}

const ACTIVE_CARD = {
  id: "rock-and-roll--noun",
  headword: "rock & roll",
  pos: "noun",
  level: "B2",
  purposes: ["ielts"],
  topics: ["music"],
  definition: "use <something>\tcarefully",
  cloze: "It\ncan ___",
  examples: ["A & B", "x < y"],
};

describe("cards:export-anki", () => {
  it("writes Anki headers, escaped fields, layout and ordered tags", () => {
    const root = temporaryRoot();
    const cwd = path.join(root, "run");
    const output = path.join("exports", "cards.tsv");
    const logSpy = vi.spyOn(consoleModule, "log").mockImplementation(() => undefined);
    writeCard(root, "rock-and-roll.json", ACTIVE_CARD);

    expect(main([output], { root, cwd })).toBe(0);

    expect(readFileSync(path.join(cwd, output), "utf8")).toBe(
      `${ANKI_HEADERS}use &lt;something&gt; carefully<br><br>It can ___\t` +
        "rock &amp; roll<br><br>• A &amp; B<br>• x &lt; y\tmusic B2 ielts\n",
    );
    expect(logSpy).toHaveBeenCalledWith(output);
  });

  it("skips retired cards and keeps active cards in filename order", () => {
    const root = temporaryRoot();
    const cwd = root;
    const output = "cards.tsv";
    vi.spyOn(consoleModule, "log").mockImplementation(() => undefined);
    const retired = {
      ...ACTIVE_CARD,
      id: "retired--noun",
      headword: "retired",
      retired: true,
    };
    const second = {
      ...ACTIVE_CARD,
      id: "second--noun",
      headword: "second",
      definition: "second definition",
      cloze: "second ___",
      examples: ["second one", "second two"],
      topics: ["topic-two"],
      purposes: ["purpose-two"],
    };
    writeCard(root, "z-retired.json", retired);
    writeCard(root, "b-second.json", second);
    writeCard(root, "a-active.json", ACTIVE_CARD);

    expect(main([output], { root, cwd })).toBe(0);

    const document = readFileSync(path.join(cwd, output), "utf8");
    expect(document).toContain("use &lt;something&gt; carefully");
    expect(document).toContain("second definition");
    expect(document).not.toContain("retired<br><br>");
    expect(document.indexOf("use &lt;something&gt; carefully")).toBeLessThan(
      document.indexOf("second definition"),
    );
  });

  it("writes only headers for an empty cards directory and uses default output", () => {
    const root = temporaryRoot();
    const cwd = temporaryRoot();
    const logSpy = vi.spyOn(consoleModule, "log").mockImplementation(() => undefined);

    expect(main([], { root, cwd })).toBe(0);

    const output = path.join(cwd, ".data", "anki-export.tsv");
    expect(readFileSync(output, "utf8")).toBe(ANKI_HEADERS);
    expect(logSpy).toHaveBeenCalledWith(path.join(".data", "anki-export.tsv"));
  });

  it("reports malformed card JSON without creating an output file", () => {
    const root = temporaryRoot();
    const cwd = root;
    const errorSpy = vi
      .spyOn(consoleModule, "error")
      .mockImplementation(() => undefined);
    writeFileSync(path.join(root, "data", "cards", "broken.json"), "{\n", "utf8");

    expect(main(["cards.tsv"], { root, cwd })).toBe(1);

    expect(existsSync(path.join(cwd, "cards.tsv"))).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      "ERR_CARDS_EXPORT_CARD: broken.json could not be read as a card. " +
        "Expected: valid UTF-8 JSON containing a card. Actual: SyntaxError. " +
        "Next: fix the file and retry `pnpm cards:export-anki`.",
    );
  });

  it("reports invalid arguments and invalid card fields", () => {
    const root = temporaryRoot();
    const errorSpy = vi
      .spyOn(consoleModule, "error")
      .mockImplementation(() => undefined);

    expect(main(["one.tsv", "two.tsv"], { root, cwd: root })).toBe(2);
    writeCard(root, "bad.json", { ...ACTIVE_CARD, examples: ["only one"] });

    expect(main(["cards.tsv"], { root, cwd: root })).toBe(1);
    expect(errorSpy).toHaveBeenNthCalledWith(
      1,
      "ERR_CARDS_EXPORT_ARGUMENT: expected at most one output path, received 2 arguments. " +
        "Next: run `pnpm cards:export-anki [output.tsv]`.",
    );
    expect(errorSpy).toHaveBeenNthCalledWith(
      2,
      "ERR_CARDS_EXPORT_CARD: bad.json has an invalid examples field. " +
        "Expected: a card JSON document with the required non-empty fields. " +
        "Next: fix the card and retry `pnpm cards:export-anki`.",
    );
  });
});
