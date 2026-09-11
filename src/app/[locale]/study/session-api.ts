import type { Rating } from "../../../core/scheduler";

/** One card of the queue, as `POST /api/sessions` sent it. */
export interface QueuedCard {
  readonly cardId: string;
  readonly definition: string;
  readonly cloze: string;
  readonly headword: string;
  readonly examples: readonly [string, string];
}

/** What `POST /api/sessions` answers with. */
export interface OpenSession {
  readonly id: number;
  readonly queue: readonly QueuedCard[];
}

/**
 * The four grades, each with the key that submits it and the message key of
 * its button label.
 *
 * @remarks
 * `as const satisfies` rather than an annotation, so a grade added to `Rating`
 * fails to compile here until it has been given a key and a label.
 */
export const RATINGS = [
  { value: 1, key: "1", label: "again" },
  { value: 2, key: "2", label: "hard" },
  { value: 3, key: "3", label: "good" },
  { value: 4, key: "4", label: "easy" },
] as const satisfies readonly { value: Rating; key: string; label: string }[];

/**
 * `url` posted, and its answer.
 *
 * @remarks
 * The answer is cast rather than validated: its shape is the handler's
 * contract, and restating it as a schema here would put a second copy of it in
 * the client bundle for requests only this application makes. A status outside
 * 2xx throws instead, which is what the page shows its failure state for.
 */
async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) {
    throw new Error(`${url} answered ${String(response.status)}`);
  }
  const answer: unknown = await response.json();
  return answer as T;
}

/** Opens a session and takes its queue. */
export function startSession(): Promise<OpenSession> {
  return postJson<OpenSession>("/api/sessions");
}

/** Records one rating, and learns whether the card comes back this session. */
export function recordReview(
  sessionId: number,
  cardId: string,
  rating: Rating,
): Promise<{ readonly requeue: boolean }> {
  return postJson(`/api/sessions/${String(sessionId)}/reviews`, { cardId, rating });
}

/** Closes a session. Its answer is the summary page's to read back. */
export function endSession(sessionId: number): Promise<unknown> {
  return postJson(`/api/sessions/${String(sessionId)}/end`);
}
