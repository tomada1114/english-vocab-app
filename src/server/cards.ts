import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ZodType } from "zod";

import {
  cardSchema,
  purposesSchema,
  topicsSchema,
  POS_VALUES,
  type Card,
  type Purpose,
} from "../core/cards/card";
import { err, ok, type Result } from "../core/result";
import { CardLoadError } from "./card-errors";

export { CardLoadError, type CardLoadErrorCode } from "./card-errors";

/** Every card a directory yielded, beside every file that yielded none. */
export interface LoadedCards {
  readonly cards: readonly Card[];
  readonly errors: readonly CardLoadError[];
}

/** The two committed lists a scope is built from. */
export interface VocabularyLists {
  readonly topics: readonly string[];
  readonly purposes: readonly Purpose[];
}

/**
 * Every card in `directory`, plus one error per file that is not one.
 *
 * @remarks
 * Never throws and never abandons the run on a bad file: one unreadable card
 * must not hide the hundreds beside it, so the failures are data a caller
 * reports. Files are read in name order; anything not ending in `.json` is
 * ignored rather than reported, since `data/cards/` holds a `.gitkeep` while
 * it is empty.
 */
export async function loadCards(directory: string): Promise<LoadedCards> {
  const names = await readCardFileNames(directory);
  if (!names.ok) {
    return { cards: [], errors: [names.error] };
  }

  const cards: Card[] = [];
  const errors: CardLoadError[] = [];
  for (const name of names.value) {
    const loaded = await loadCard(directory, name);
    if (loaded.ok) {
      cards.push(loaded.value);
    } else {
      errors.push(loaded.error);
    }
  }
  return { cards, errors };
}

/**
 * The topic and purpose lists `dataDirectory` holds, validated.
 *
 * @remarks
 * This throws where {@link loadCards} collects: a malformed card is one file
 * of many, but a missing or malformed list leaves no vocabulary to build a
 * scope out of at all — a repository mistake with no caller-side recovery.
 * @throws A {@link CardLoadError} naming the list file that failed.
 */
export async function loadLists(dataDirectory: string): Promise<VocabularyLists> {
  const topicsFile = path.join(dataDirectory, "topics.json");
  const purposesFile = path.join(dataDirectory, "purposes.json");
  const [topics, purposes] = await Promise.all([
    readJson(topicsFile),
    readJson(purposesFile),
  ]);
  if (!topics.ok) {
    throw topics.error;
  }
  if (!purposes.ok) {
    throw purposes.error;
  }
  return {
    topics: parseOrThrow(topicsSchema, topics.value, topicsFile),
    purposes: parseOrThrow(purposesSchema, purposes.value, purposesFile),
  };
}

// The shape `cardId(headword, pos)` produces, built from `POS_VALUES` so an
// added part of speech stays in step; already enforced on every committed
// file by the card Lint's `E_ID_MISMATCH`, so it excludes no real card.
const CARD_ID_PATTERN = new RegExp(
  `^[a-z0-9]+(?:-[a-z0-9]+)*--(?:${POS_VALUES.join("|")})$`,
  "u",
);

/**
 * The card `cardId` names, or `undefined` when the deck does not hold it.
 *
 * @remarks
 * Reads exactly one file. Every failure — a malformed id, an unreadable or
 * missing file, invalid JSON, a schema failure, a misfiled id — answers
 * `undefined`, same as `loadCards` dropping that file; reasons are not
 * returned because the one caller must not leak a path into its fixed
 * refusal. Two independent guards run first: `cardId` must match
 * {@link CARD_ID_PATTERN} (rejecting `.`, `/`, `\`, NUL, uppercase, empty),
 * and the resolved parent of the target file must equal `directory`.
 */
export async function loadCardById(
  directory: string,
  cardId: string,
): Promise<Card | undefined> {
  if (!CARD_ID_PATTERN.test(cardId)) {
    return undefined;
  }
  const name = `${cardId}.json`;
  const file = path.join(directory, name);
  if (path.dirname(path.resolve(file)) !== path.resolve(directory)) {
    return undefined;
  }
  const loaded = await loadCard(directory, name);
  return loaded.ok ? loaded.value : undefined;
}

/** The `.json` entries of `directory` in name order, or why it was not listed. */
async function readCardFileNames(
  directory: string,
): Promise<Result<string[], CardLoadError>> {
  try {
    const entries = await readdir(directory);
    return ok(entries.filter((entry) => entry.endsWith(".json")).sort());
  } catch (cause) {
    const message = "The card directory could not be read.";
    return err(new CardLoadError("ERR_CARD_UNREADABLE", directory, message, { cause }));
  }
}

/** One file of `directory` as a card, or the single reason it is not one. */
async function loadCard(
  directory: string,
  name: string,
): Promise<Result<Card, CardLoadError>> {
  const file = path.join(directory, name);
  const json = await readJson(file);
  if (!json.ok) {
    return json;
  }

  const parsed = cardSchema.safeParse(json.value);
  if (!parsed.success) {
    return err(
      new CardLoadError(
        "ERR_CARD_SCHEMA",
        file,
        "The file does not match the card schema.",
        { cause: parsed.error },
      ),
    );
  }
  if (parsed.data.id !== path.basename(name, ".json")) {
    return err(
      new CardLoadError(
        "ERR_CARD_ID_MISMATCH",
        file,
        "The file name is not the id the card declares.",
      ),
    );
  }
  return ok(parsed.data);
}

/** `file` parsed as JSON, or which half of that failed. */
async function readJson(file: string): Promise<Result<unknown, CardLoadError>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (cause) {
    const message = "The file could not be read.";
    return err(new CardLoadError("ERR_CARD_UNREADABLE", file, message, { cause }));
  }

  try {
    return ok(JSON.parse(text) as unknown);
  } catch (cause) {
    const message = "The file is not valid JSON.";
    return err(new CardLoadError("ERR_CARD_INVALID_JSON", file, message, { cause }));
  }
}

/** `value` as what `schema` describes, or a {@link CardLoadError} naming `file`. */
function parseOrThrow<T>(schema: ZodType<T>, value: unknown, file: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const message = "The file does not match its schema.";
    throw new CardLoadError("ERR_CARD_SCHEMA", file, message, { cause: parsed.error });
  }
  return parsed.data;
}
