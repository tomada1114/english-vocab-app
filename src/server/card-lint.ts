import "server-only";

import path from "node:path";

import { lintCards, type LintFinding } from "../core/cards/lint";
import { loadCards, loadLists, type CardLoadError } from "./cards";

/**
 * Everything the card Lint has to say about the cards in `dataDirectory`.
 *
 * @remarks
 * The one entry point that puts the reader and the rules together: it loads
 * `<dataDirectory>/cards/` and the two committed lists beside it, then lints
 * what came back. A file the loader could not turn into a card never reaches
 * {@link lintCards}, so its failure is reported here instead — as `E_SCHEMA`,
 * or as `E_ID_MISMATCH` for the one failure that is about the name rather than
 * the content. That keeps "what is wrong with `data/`" one list rather than
 * two, which is what `tests/card-data.test.ts` prints.
 *
 * The lists are the exception: a missing or malformed `topics.json` throws,
 * for the reason {@link loadLists} gives — there is no per-card recovery from
 * a vocabulary that could not be read at all.
 *
 * @param dataDirectory - The directory holding `cards/` and the two lists.
 * @throws A `CardLoadError` naming the list file that could not be read.
 */
export async function lintDataDirectory(dataDirectory: string): Promise<LintFinding[]> {
  const lists = await loadLists(dataDirectory);
  const { cards, errors } = await loadCards(path.join(dataDirectory, "cards"));
  // Every loaded card was read from `<id>.json` — the loader reports the file
  // whose name is anything else rather than returning it — so the name is
  // derived here instead of threading it back out of the loader.
  const entries = cards.map((card) => ({ fileName: `${card.id}.json`, card }));
  return [...errors.map(asFinding), ...lintCards(entries, lists)];
}

/** One line of a report: the file, the rule it broke, and what is wrong. */
export function formatFinding(finding: LintFinding): string {
  return `${finding.file} — ${finding.rule} — ${finding.message}`;
}

/** A file the loader rejected, said in the Lint's own vocabulary. */
function asFinding(error: CardLoadError): LintFinding {
  const rule = error.code === "ERR_CARD_ID_MISMATCH" ? "E_ID_MISMATCH" : "E_SCHEMA";
  return {
    severity: "ERROR",
    rule,
    file: path.basename(error.file),
    message: `${error.message} (${error.code})`,
  };
}
