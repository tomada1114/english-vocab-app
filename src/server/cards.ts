import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ZodType } from "zod";

import {
  cardSchema,
  purposesSchema,
  topicsSchema,
  type Card,
  type Purpose,
} from "../core/cards/card";
import { err, ok, type Result } from "../core/result";

/**
 * Why one file under `data/` could not be read as what it declares.
 *
 * @remarks
 * Four structurally different failures, so a caller can tell a malformed file
 * from a misfiled one. Every other card rule — an id that does not match its
 * key, an unknown topic, the text itself — is the Lint's vocabulary instead.
 */
export type CardLoadErrorCode =
  | "ERR_CARD_UNREADABLE"
  | "ERR_CARD_INVALID_JSON"
  | "ERR_CARD_SCHEMA"
  | "ERR_CARD_ID_MISMATCH";

/** One file under `data/` that could not be loaded, and why. */
export class CardLoadError extends Error {
  /** A literal union, not `string`: this is what a caller narrows on. */
  readonly code: CardLoadErrorCode;
  /** The path that failed — never the content that was at it. */
  readonly file: string;

  constructor(
    code: CardLoadErrorCode,
    file: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CardLoadError";
    this.code = code;
    this.file = file;
  }
}

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
 * It never throws, and never abandons the run on a bad file: one unreadable
 * card must not hide the hundreds beside it, so the failures are data a caller
 * reports rather than an exception that ends the page. A directory that cannot
 * be listed at all comes back as a single error against the directory itself.
 * Files are read in name order, and anything not ending in `.json` is ignored
 * rather than reported: `data/cards/` holds a `.gitkeep` while it is empty.
 *
 * @param directory - The directory holding one JSON file per card.
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
 * This throws where {@link loadCards} collects, because the two failures are
 * not the same kind of thing. A malformed card is one file of many and the app
 * still has cards to show; a missing or malformed list leaves no vocabulary to
 * build a scope out of at all — a repository mistake with no caller-side
 * recovery, the reasoning `src/server/env.ts` reads the environment with.
 *
 * @param dataDirectory - The directory holding the two list files.
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
