import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  endSession,
  readSessionSummary,
  recordReview,
  startSession,
} from "../src/server/composition";

// The composition root, driven as a whole: the environment read, the database
// opened from it, the deck read off `data/cards/`, and the three handlers
// wired over all of it. Every other suite hands a handler its dependencies, so
// this is the only one that proves they are actually joined — and the only one
// that touches the filesystem, which is what puts it in the `automation`
// project rather than `unit`.
//
// `VOCAB_DB_PATH` is stubbed to `:memory:`, so the run writes no file: the
// wiring is built on the first request below and memoized for the rest of the
// file, which is the once-per-process behavior being asserted.

beforeEach(() => {
  vi.stubEnv("VOCAB_DB_PATH", ":memory:");
});

function post(url: string, body?: unknown): Request {
  return new Request(url, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function open(): Promise<number> {
  const response = await startSession(post("http://localhost/api/sessions"));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { sessionId: number; queue: unknown[] };
  expect(Array.isArray(body.queue)).toBe(true);
  return body.sessionId;
}

describe("the composed study-session endpoints", () => {
  it("opens a session against the database the environment names", async () => {
    expect(await open()).toBeGreaterThan(0);
  });

  it("keeps one database for the whole process, so ids keep counting up", async () => {
    const first = await open();
    const second = await open();

    expect(second).toBe(first + 1);
  });

  it("refuses a rating for a card the committed deck does not hold", async () => {
    const id = await open();

    const response = await recordReview(
      post(`http://localhost/api/sessions/${String(id)}/reviews`, {
        cardId: "no-such-card--noun",
        rating: 3,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "ERR_SESSION_CARD_NOT_FOUND" },
    });
  });

  it("ends a session it opened, and reads the same figures back for the summary", async () => {
    const id = await open();

    const response = await endSession(
      post(`http://localhost/api/sessions/${String(id)}/end`),
    );
    const ended = (await response.json()) as {
      reviewed: number;
      rememberedBefore: number;
      rememberedAfter: number;
    };

    expect(response.status).toBe(200);
    await expect(readSessionSummary(id)).resolves.toMatchObject({
      reviewed: ended.reviewed,
      rememberedBefore: ended.rememberedBefore,
      rememberedAfter: ended.rememberedAfter,
    });
  });

  it("reports no summary for a session id nothing opened", async () => {
    await expect(readSessionSummary(9_999)).resolves.toBeUndefined();
  });
});
