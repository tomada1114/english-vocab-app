#!/usr/bin/env node
// Export committed vocabulary cards in the text format Anki imports.
// The script stays dependency-free so it remains runnable before pnpm install.
import console from "node:console";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseJson, readKey, readString } from "./lib/json.mjs";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const CARDS_DIRECTORY = path.join("data", "cards");
const DEFAULT_OUTPUT_PATH = path.join(".data", "anki-export.tsv");
const ANKI_HEADERS = ["#separator:tab", "#html:true", "#tags column:3"];

/**
 * A card's fields used by the Anki note layout.
 *
 * @typedef {object} ExportCard
 * @property {string} headword - The answer on the back.
 * @property {string} definition - The definition on the front.
 * @property {string} cloze - The cloze sentence on the front.
 * @property {string[]} examples - The two examples on the back.
 * @property {string} level - The CEFR level tag.
 * @property {string[]} topics - The topic tags.
 * @property {string[]} purposes - The purpose tags.
 * @property {boolean} retired - Whether the card is excluded from export.
 */

/**
 * Options for {@link main}; the seams keep tests out of the real checkout.
 *
 * @typedef {object} ExportOptions
 * @property {string} [root] - Repository root containing `data/cards`.
 * @property {string} [cwd] - Working directory for relative output paths.
 */

/**
 * Keep a path in diagnostics free of an absolute home-directory prefix.
 *
 * @param {string} file - An absolute path.
 * @param {string} cwd - The command's working directory.
 * @returns {string} A path relative to the command directory.
 */
function displayPath(file, cwd) {
  return path.relative(cwd, file) || ".";
}

/**
 * Reduce an unknown failure to a safe one-line name.
 *
 * @param {unknown} error - A caught failure.
 * @returns {string} The error name, without its potentially sensitive message.
 */
function failureName(error) {
  return error instanceof Error ? error.name : "unknown failure";
}

/**
 * Make a card filename safe to place in one diagnostic line.
 *
 * @param {string} file - The card path.
 * @returns {string} The basename with control line breaks removed.
 */
function displayCardFile(file) {
  return path.basename(file).replace(/[\t\r\n]/g, " ");
}

/**
 * Build a card-shape failure without including card content in the report.
 *
 * @param {string} file - The invalid card path.
 * @param {string} field - The invalid field name.
 * @returns {Error} A coded export failure.
 */
function cardError(file, field) {
  return new Error(
    `ERR_CARDS_EXPORT_CARD: ${displayCardFile(file)} has an invalid ${field} field. ` +
      "Expected: a card JSON document with the required non-empty fields. " +
      "Next: fix the card and retry `pnpm cards:export-anki`.",
  );
}

/**
 * Read a required string field from a parsed JSON value.
 *
 * @param {unknown} value - Parsed JSON.
 * @param {string} field - Field name.
 * @param {string} file - Card path for diagnostics.
 * @returns {string} The required field.
 */
function requiredString(value, field, file) {
  const result = readString(value, field);
  if (result === undefined || result.length === 0) {
    throw cardError(file, field);
  }
  return result;
}

/**
 * Read an array whose entries must all be strings.
 *
 * @param {unknown} value - Parsed JSON.
 * @param {string} field - Field name.
 * @param {string} file - Card path for diagnostics.
 * @returns {string[]} The string entries.
 */
function stringArray(value, field, file) {
  const raw = readKey(value, field);
  if (!Array.isArray(raw)) {
    throw cardError(file, field);
  }

  /** @type {string[]} */
  const result = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw cardError(file, field);
    }
    result.push(entry);
  }
  return result;
}

/**
 * Narrow one card from a parsed JSON document.
 *
 * @param {unknown} value - Parsed JSON.
 * @param {string} file - Card path for diagnostics.
 * @returns {ExportCard} The fields needed by the exporter.
 */
function parseCard(value, file) {
  // Validate the identity fields too, even though they are not rendered.
  requiredString(value, "id", file);
  requiredString(value, "pos", file);
  const headword = requiredString(value, "headword", file);
  const level = requiredString(value, "level", file);
  const definition = requiredString(value, "definition", file);
  const cloze = requiredString(value, "cloze", file);
  const topics = stringArray(value, "topics", file);
  const purposes = stringArray(value, "purposes", file);
  const examples = stringArray(value, "examples", file);
  if (examples.length !== 2) {
    throw cardError(file, "examples");
  }

  const retired = readKey(value, "retired");
  if (retired !== undefined && retired !== true) {
    throw cardError(file, "retired");
  }

  return {
    headword,
    definition,
    cloze,
    examples,
    level,
    topics,
    purposes,
    retired: retired === true,
  };
}

/**
 * Read all JSON card files in deterministic filename order.
 *
 * @param {string} directory - The cards directory.
 * @returns {ExportCard[]} Parsed cards.
 */
function readCards(directory) {
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return files.map((name) => {
    const file = path.join(directory, name);
    try {
      return parseCard(parseJson(readFileSync(file, "utf8")), file);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("ERR_CARDS_EXPORT_CARD:")
      ) {
        throw error;
      }
      throw new Error(
        `ERR_CARDS_EXPORT_CARD: ${displayCardFile(file)} could not be read as a card. ` +
          "Expected: valid UTF-8 JSON containing a card. " +
          `Actual: ${failureName(error)}. Next: fix the file and retry \`pnpm cards:export-anki\`.`,
        { cause: error },
      );
    }
  });
}

/**
 * Replace TSV-breaking characters with one ordinary space.
 *
 * @param {string} value - Card text or a tag.
 * @returns {string} A single-line value.
 */
function singleLine(value) {
  return value.replace(/[\t\r\n]+/g, " ");
}

/**
 * Escape the HTML characters Anki interprets in field columns.
 *
 * @param {string} value - Card field text.
 * @returns {string} Single-line escaped HTML.
 */
function htmlText(value) {
  return singleLine(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Render one active card as an Anki note row.
 *
 * @param {ExportCard} card - Card to render.
 * @returns {string} Front, back and tags separated by tabs.
 */
function renderCard(card) {
  const front = `${htmlText(card.definition)}<br><br>${htmlText(card.cloze)}`;
  const examples = card.examples.map((example) => htmlText(example)).join("<br>• ");
  const back = `${htmlText(card.headword)}<br><br>• ${examples}`;
  const tags = [...card.topics, card.level, ...card.purposes].map(singleLine).join(" ");
  return `${front}\t${back}\t${tags}`;
}

/**
 * Render the complete Anki TSV document.
 *
 * @param {ExportCard[]} cards - Cards to export.
 * @returns {string} Anki headers and note rows.
 */
function renderExport(cards) {
  const rows = cards.filter((card) => !card.retired).map(renderCard);
  const body = rows.length === 0 ? "" : `${rows.join("\n")}\n`;
  return `${ANKI_HEADERS.join("\n")}\n${body}`;
}

/**
 * Export cards to an Anki-importable TSV file.
 *
 * @param {string[]} [argv=process.argv.slice(2)] - At most one output path.
 * @param {ExportOptions} [options] - Optional test seams.
 * @returns {number} Process exit code: 0 on success, 1 on failure, 2 on bad arguments.
 */
export function main(argv = process.argv.slice(2), options = {}) {
  if (argv.length > 1) {
    console.error(
      `ERR_CARDS_EXPORT_ARGUMENT: expected at most one output path, received ${String(argv.length)} arguments. ` +
        "Next: run `pnpm cards:export-anki [output.tsv]`.",
    );
    return 2;
  }

  const root = path.resolve(options.root ?? REPOSITORY_ROOT);
  const cwd = options.cwd ?? process.cwd();
  const output = path.resolve(cwd, argv[0] ?? DEFAULT_OUTPUT_PATH);
  const cardsDirectory = path.join(root, CARDS_DIRECTORY);

  try {
    const cards = readCards(cardsDirectory);
    const document = renderExport(cards);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, document, "utf8");
    console.log(displayPath(output, cwd));
    return 0;
  } catch (error) {
    const message =
      error instanceof Error && error.message.startsWith("ERR_CARDS_EXPORT_CARD:")
        ? error.message
        : `ERR_CARDS_EXPORT_FAILED: could not export ${displayPath(cardsDirectory, cwd)} to ${displayPath(output, cwd)}. ` +
          "Expected: readable card JSON files and a writable output directory. " +
          `Actual: ${failureName(error)}. Next: check the paths and retry \`pnpm cards:export-anki\`.`;
    console.error(message);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = main();
}
