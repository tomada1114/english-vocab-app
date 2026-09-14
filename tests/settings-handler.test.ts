import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import * as z from "zod";

import { POST as SETTINGS_ROUTE } from "../src/app/api/settings/route";
import { scopeSchema, type Scope } from "../src/core/scope";
import { updateSettings } from "../src/server/composition";
import type { VocabularyLists } from "../src/server/cards";
import { openDatabase } from "../src/server/db/connection";
import { createStore, type Store } from "../src/server/db/queries";
import { createSettingsHandler } from "../src/server/handlers/settings";

const LISTS: VocabularyLists = {
  purposes: [{ id: "ielts", label: "IELTS" }],
  topics: ["education", "environment"],
};

const INITIAL_SCOPE: Scope = {
  purpose: "ielts",
  topics: ["education"],
  target: { exam: "ielts", score: 7 },
};

const openConnections: DatabaseSync[] = [];

afterEach(() => {
  while (openConnections.length > 0) {
    openConnections.pop()?.close();
  }
});

function openStore(): Store {
  const database = openDatabase(":memory:");
  openConnections.push(database);
  return createStore(database);
}

function handlerFor(store: Store) {
  return createSettingsHandler({
    store,
    readLists: () => Promise.resolve(LISTS),
  });
}

function requestWith(body: unknown): Request {
  return new Request("http://localhost/api/settings", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("POST /api/settings", () => {
  it("persists and returns both settings for a valid request", async () => {
    const store = openStore();
    const settings = {
      scope: { purpose: "ielts", topics: [], target: null },
      newCardsPerDay: 25,
    };

    const response = await handlerFor(store)(requestWith(settings));

    expect(response.status).toBe(200);
    expect(await responseBody(response)).toStrictEqual(settings);
    expect(store.getSetting("scope", scopeSchema)).toStrictEqual(settings.scope);
    expect(store.getSetting("newCardsPerDay", z.int().positive())).toBe(25);
  });

  it("re-exports the composed handler from the Route Handler", () => {
    expect(SETTINGS_ROUTE).toBe(updateSettings);
  });

  it("preserves the shared malformed JSON response", async () => {
    const store = openStore();
    const response = await handlerFor(store)(
      new Request("http://localhost/api/settings", {
        method: "POST",
        body: "not json",
      }),
    );

    expect(response.status).toBe(400);
    expect((await responseBody(response))["error"]).toMatchObject({
      code: "ERR_BAD_REQUEST",
    });
  });

  it.each([
    ["an array", []],
    ["a missing scope", { newCardsPerDay: 20 }],
    ["a missing limit", { scope: INITIAL_SCOPE }],
    [
      "an extra top-level key",
      { scope: INITIAL_SCOPE, newCardsPerDay: 20, extra: true },
    ],
    [
      "an extra scope key",
      { scope: { ...INITIAL_SCOPE, extra: true }, newCardsPerDay: 20 },
    ],
    [
      "an unknown purpose",
      { scope: { ...INITIAL_SCOPE, purpose: "toefl" }, newCardsPerDay: 20 },
    ],
    [
      "an unknown topic",
      { scope: { ...INITIAL_SCOPE, topics: ["unknown"] }, newCardsPerDay: 20 },
    ],
    [
      "an invalid target exam",
      {
        scope: { ...INITIAL_SCOPE, target: { exam: "toefl", score: 7 } },
        newCardsPerDay: 20,
      },
    ],
    [
      "an invalid target score",
      {
        scope: { ...INITIAL_SCOPE, target: { exam: "ielts", score: 3 } },
        newCardsPerDay: 20,
      },
    ],
    ["a zero daily limit", { scope: INITIAL_SCOPE, newCardsPerDay: 0 }],
    ["a daily limit above 100", { scope: INITIAL_SCOPE, newCardsPerDay: 101 }],
    ["a fractional daily limit", { scope: INITIAL_SCOPE, newCardsPerDay: 10.5 }],
  ] as const)("rejects %s without changing stored settings", async (_label, body) => {
    const store = openStore();
    store.replaceSettings({ scope: INITIAL_SCOPE, newCardsPerDay: 20 });

    const response = await handlerFor(store)(requestWith(body));

    expect(response.status).toBe(400);
    expect((await responseBody(response))["error"]).toMatchObject({
      code: "ERR_SETTINGS_REQUEST_INVALID",
    });
    expect(store.getSetting("scope", scopeSchema)).toStrictEqual(INITIAL_SCOPE);
    expect(store.getSetting("newCardsPerDay", z.int().positive())).toBe(20);
  });
});
