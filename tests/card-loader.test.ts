import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { cardId, cardSchema } from "../src/core/cards/card";
import { CardLoadError, loadCardById, loadCards, loadLists } from "../src/server/cards";

// The loader is the only reader of `data/`, so this suite drives it over real
// directories rather than over a mocked filesystem: a fixture tree holding one
// file per failure it has to report, and temp directories for the failures a
// committed fixture cannot express. It also reads the committed `data/` tree
// itself, which is what makes a malformed list file or a misfiled card fail CI
// rather than the first page that asks for one.
//
// The card Lint — unknown topics, the content rules — is a separate concern
// and will bring its own suite; nothing here asserts a rule about card text.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const fixtureCards = path.join(repoRoot, "tests", "fixtures", "cards");
const dataDirectory = path.join(repoRoot, "data");

/**
 * The 15 topic ids, in the order `card-data.md` lists them.
 *
 * @remarks
 * Written out here rather than read from `data/topics.json`: an expectation
 * derived from the file under test would agree with any edit of it, which is
 * the one thing a fixed list must not do.
 */
const TOPIC_IDS = [
  "education",
  "work",
  "business-economy",
  "science-technology",
  "environment",
  "health",
  "media-advertising",
  "travel-tourism",
  "cities-housing",
  "crime-law",
  "government-society",
  "family-relationships",
  "culture-arts",
  "food",
  "sport-leisure",
];

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

/** A fresh temp directory, removed after the test that asked for it. */
function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "card-loader-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** Whatever `promise` rejected with, or `undefined` when it resolved. */
function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (cause: unknown) => cause,
  );
}

describe("loadCards over a tree holding one file per failure", () => {
  it("returns every card the tree holds, in file-name order", async () => {
    const { cards } = await loadCards(fixtureCards);
    expect(cards.map((card) => card.id)).toStrictEqual([
      "carbon-footprint--noun",
      "mitigate--verb",
      "resilience--noun",
      "well-being--noun",
    ]);
  });

  it("keeps the optional retired flag a card declares", async () => {
    const { cards } = await loadCards(fixtureCards);
    expect(cards.find((card) => card.id === "well-being--noun")?.retired).toBe(true);
    expect(cards.find((card) => card.id === "mitigate--verb")?.retired).toBeUndefined();
  });

  it("reports one error per bad file, and none for the plain-text file", async () => {
    const { errors } = await loadCards(fixtureCards);
    expect(
      errors.map((error) => [path.basename(error.file), error.code]),
    ).toStrictEqual([
      ["broken--noun.json", "ERR_CARD_INVALID_JSON"],
      ["misfiled--noun.json", "ERR_CARD_ID_MISMATCH"],
      ["unknown-key--noun.json", "ERR_CARD_SCHEMA"],
    ]);
  });

  it("reports each failure as a CardLoadError naming the file it read", async () => {
    const { errors } = await loadCards(fixtureCards);
    for (const error of errors) {
      expect(error).toBeInstanceOf(CardLoadError);
      expect(error.file.startsWith(fixtureCards)).toBe(true);
    }
  });

  it("keeps a bad file from hiding the cards beside it", async () => {
    const { cards, errors } = await loadCards(fixtureCards);
    expect(cards.length).toBe(4);
    expect(errors.length).toBe(3);
  });
});

describe("loadCards when a path will not read", () => {
  it("reports the directory itself when it does not exist", async () => {
    const missing = path.join(temporaryDirectory(), "absent");
    const { cards, errors } = await loadCards(missing);
    expect(cards).toStrictEqual([]);
    expect(errors.map((error) => [error.code, error.file])).toStrictEqual([
      ["ERR_CARD_UNREADABLE", missing],
    ]);
  });

  it("reports a .json entry that is a directory rather than a file", async () => {
    const directory = temporaryDirectory();
    mkdirSync(path.join(directory, "oops.json"));
    const { cards, errors } = await loadCards(directory);
    expect(cards).toStrictEqual([]);
    expect(errors.map((error) => [error.code, error.file])).toStrictEqual([
      ["ERR_CARD_UNREADABLE", path.join(directory, "oops.json")],
    ]);
  });

  it("returns nothing at all for an empty directory", async () => {
    expect(await loadCards(temporaryDirectory())).toStrictEqual({
      cards: [],
      errors: [],
    });
  });
});

describe("loadCards over the committed data/cards tree", () => {
  it("reports no error, so a bad card file fails CI rather than a page", async () => {
    const { errors } = await loadCards(path.join(dataDirectory, "cards"));
    expect(
      errors.map((error) => [path.basename(error.file), error.code]),
    ).toStrictEqual([]);
  });
});

describe("loadLists over the committed data/ tree", () => {
  it("returns the 15 topic ids in the order card-data.md lists them", async () => {
    const { topics } = await loadLists(dataDirectory);
    expect(topics).toStrictEqual(TOPIC_IDS);
  });

  it("returns IELTS as the only purpose", async () => {
    const { purposes } = await loadLists(dataDirectory);
    expect(purposes).toStrictEqual([{ id: "ielts", label: "IELTS" }]);
  });
});

describe("loadLists when a list file is missing or malformed", () => {
  /** A data directory holding the two list files, each with the given text. */
  function listsWith(topics: string, purposes: string): string {
    const directory = temporaryDirectory();
    writeFileSync(path.join(directory, "topics.json"), topics);
    writeFileSync(path.join(directory, "purposes.json"), purposes);
    return directory;
  }

  const validPurposes = '[{ "id": "ielts", "label": "IELTS" }]';

  it("throws for a directory holding neither list", async () => {
    const directory = temporaryDirectory();
    const error = await rejection(loadLists(directory));
    expect(error).toBeInstanceOf(CardLoadError);
    expect(error).toMatchObject({
      code: "ERR_CARD_UNREADABLE",
      file: path.join(directory, "topics.json"),
    });
  });

  it("throws for a missing purpose list beside a readable topic list", async () => {
    const directory = temporaryDirectory();
    writeFileSync(path.join(directory, "topics.json"), '["education"]');
    const error = await rejection(loadLists(directory));
    expect(error).toMatchObject({
      code: "ERR_CARD_UNREADABLE",
      file: path.join(directory, "purposes.json"),
    });
  });

  it("throws for a list file that is not JSON", async () => {
    const directory = listsWith("[not json", validPurposes);
    const error = await rejection(loadLists(directory));
    expect(error).toBeInstanceOf(CardLoadError);
    expect(error).toMatchObject({
      code: "ERR_CARD_INVALID_JSON",
      file: path.join(directory, "topics.json"),
    });
  });

  it("throws for an empty topic list", async () => {
    const directory = listsWith("[]", validPurposes);
    const error = await rejection(loadLists(directory));
    expect(error).toMatchObject({
      code: "ERR_CARD_SCHEMA",
      file: path.join(directory, "topics.json"),
    });
  });

  it("throws for a purpose missing its label", async () => {
    const directory = listsWith('["education"]', '[{ "id": "ielts" }]');
    const error = await rejection(loadLists(directory));
    expect(error).toMatchObject({
      code: "ERR_CARD_SCHEMA",
      file: path.join(directory, "purposes.json"),
    });
  });

  it("throws for a purpose carrying a key the schema does not declare", async () => {
    const directory = listsWith(
      '["education"]',
      '[{ "id": "ielts", "label": "IELTS", "note": "extra" }]',
    );
    const error = await rejection(loadLists(directory));
    expect(error).toMatchObject({ code: "ERR_CARD_SCHEMA" });
  });
});

describe("loadCardById", () => {
  it("returns the card whose file is in the directory", async () => {
    const card = await loadCardById(fixtureCards, "mitigate--verb");
    expect(card?.id).toBe("mitigate--verb");
  });

  it("agrees with loadCards on every card the fixture tree holds", async () => {
    const { cards } = await loadCards(fixtureCards);
    for (const card of cards) {
      expect(await loadCardById(fixtureCards, card.id)).toStrictEqual(card);
    }
  });

  it("returns undefined for an id no file answers", async () => {
    expect(await loadCardById(fixtureCards, "no-such-card--noun")).toBeUndefined();
  });

  it("returns undefined for a file that is not valid JSON", async () => {
    expect(await loadCardById(fixtureCards, "broken--noun")).toBeUndefined();
  });

  it("returns undefined for a file that fails the card schema", async () => {
    expect(await loadCardById(fixtureCards, "unknown-key--noun")).toBeUndefined();
  });

  it("returns undefined for a file whose declared id is not its name", async () => {
    expect(await loadCardById(fixtureCards, "misfiled--noun")).toBeUndefined();
  });

  it("returns undefined for a directory that does not exist", async () => {
    const missing = path.join(temporaryDirectory(), "absent");
    expect(await loadCardById(missing, "mitigate--verb")).toBeUndefined();
  });

  it.each([
    ["an empty id", ""],
    ["a parent-directory segment", "../resilience--noun"],
    ["a deeper traversal", "../../etc/passwd"],
    ["a nested path segment", "sub/dir--noun"],
    ["a leading slash", "/mitigate--verb"],
    ["a trailing extension", "mitigate--verb.json"],
    ["uppercase letters", "Mitigate--verb"],
    ["a part of speech the schema does not know", "mitigate--pronoun"],
    ["a NUL byte", "mitigate--verb\0"],
  ])("returns undefined, and does not throw, for %s", async (_case, id) => {
    await expect(loadCardById(fixtureCards, id)).resolves.toBeUndefined();
  });

  it("still returns undefined when the traversal target is a real card file", async () => {
    const root = temporaryDirectory();
    const subdirectory = path.join(root, "sub");
    mkdirSync(subdirectory);
    writeFileSync(
      path.join(root, "mitigate--verb.json"),
      readFileSync(path.join(fixtureCards, "mitigate--verb.json")),
    );

    expect(await loadCardById(subdirectory, "../mitigate--verb")).toBeUndefined();
  });

  it("reads only the file it names, ignoring an unreadable file beside it", async () => {
    const directory = temporaryDirectory();
    writeFileSync(
      path.join(directory, "mitigate--verb.json"),
      readFileSync(path.join(fixtureCards, "mitigate--verb.json")),
    );
    mkdirSync(path.join(directory, "unreadable--noun.json"));

    const card = await loadCardById(directory, "mitigate--verb");

    expect(card?.id).toBe("mitigate--verb");
  });
});

describe("the example card in the card-data reference", () => {
  const reference = readFileSync(
    path.join(
      repoRoot,
      ".agents",
      "skills",
      "building-the-vocab-app",
      "references",
      "card-data.md",
    ),
    "utf8",
  );
  const block = /```json\n([\s\S]*?)```/.exec(reference)?.[1];
  const example: unknown = JSON.parse(block ?? "null");

  it("is a card the schema accepts, so the documented shape is the real one", () => {
    expect(cardSchema.safeParse(example)).toMatchObject({ success: true });
  });

  it("carries the id its own key derives", () => {
    const card = cardSchema.parse(example);
    expect(card.id).toBe(cardId(card.headword, card.pos));
  });
});
