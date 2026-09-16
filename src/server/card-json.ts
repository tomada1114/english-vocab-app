import "server-only";

import { readFile } from "node:fs/promises";

import { err, ok, type Result } from "../core/result";
import { CardLoadError } from "./card-errors";

/** `file` parsed as JSON, or which half of that failed. */
export async function readJson(file: string): Promise<Result<unknown, CardLoadError>> {
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
