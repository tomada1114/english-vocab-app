import "server-only";

import * as z from "zod";

import { scopeSchema, type Scope } from "../../core/scope";
import type { VocabularyLists } from "../cards";
import type { Store } from "../db/queries";
import { failure, readJsonBody, type RequestHandler } from "../http";

/** The only parsed-request failure this endpoint exposes. */
export type SettingsErrorCode = "ERR_SETTINGS_REQUEST_INVALID";

const SETTINGS_ERROR_STATUS = {
  ERR_SETTINGS_REQUEST_INVALID: 400,
} as const satisfies Record<SettingsErrorCode, number>;

const SETTINGS_ERROR_MESSAGE = {
  ERR_SETTINGS_REQUEST_INVALID:
    "The settings request does not match the supported scope and daily limit.",
} as const satisfies Record<SettingsErrorCode, string>;

const settingsRequestSchema = z.strictObject({
  scope: scopeSchema,
  newCardsPerDay: z.int().min(1).max(100),
});

/** Dependencies that keep settings validation independent of the filesystem. */
export interface SettingsDependencies {
  readonly store: Store;
  readonly readLists: () => Promise<VocabularyLists>;
}

function settingsFailure(code: SettingsErrorCode): Response {
  return failure(SETTINGS_ERROR_STATUS[code], code, SETTINGS_ERROR_MESSAGE[code]);
}

function hasKnownTags(scope: Scope, lists: VocabularyLists): boolean {
  const purposes = new Set(lists.purposes.map((purpose) => purpose.id));
  const topics = new Set(lists.topics);
  return (
    purposes.has(scope.purpose) && scope.topics.every((topic) => topics.has(topic))
  );
}

/** Builds the Web-standard `POST /api/settings` handler. */
export function createSettingsHandler(
  dependencies: SettingsDependencies,
): RequestHandler {
  return async (request: Request): Promise<Response> => {
    const body = await readJsonBody(request);
    if (!body.ok) {
      return body.error;
    }

    const parsed = settingsRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return settingsFailure("ERR_SETTINGS_REQUEST_INVALID");
    }

    const lists = await dependencies.readLists();
    if (!hasKnownTags(parsed.data.scope, lists)) {
      return settingsFailure("ERR_SETTINGS_REQUEST_INVALID");
    }

    dependencies.store.replaceSettings(parsed.data);
    return Response.json(parsed.data);
  };
}
