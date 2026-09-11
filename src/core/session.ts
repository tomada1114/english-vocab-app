import { LEVELS, type Card } from "./cards/card";
import type { SchedulerPhase, SchedulerState } from "./scheduler";

/**
 * Anki's learn-ahead window: a card rated during a session may come back
 * within this much time without waiting for its exact due instant, so a
 * short learning step does not force the session to sit idle.
 */
export const LEARN_AHEAD_MS = 20 * 60 * 1000;

/**
 * The order cards are studied in, as ids: reviewed cards first, then new
 * ones. `afterRating` and `nextCard` locate a card by id rather than by
 * position, since a requeue moves it to the end regardless of where it was.
 */
export type SessionQueue = readonly string[];

export interface BuildQueueInput {
  readonly cards: readonly Card[];
  /** Every card's scheduler state, keyed by card id. A card with no entry is new. */
  readonly states: ReadonlyMap<string, SchedulerState>;
  /**
   * Accepted for symmetry with `afterRating`/`nextCard`; unused here because
   * "due today" is entirely decided by `dayEndMs`, not by the instant the
   * queue happens to be built at.
   */
  readonly nowMs: number;
  /** The next 04:00 rollover: a reviewed card is due today when `due` falls before it. */
  readonly dayEndMs: number;
  readonly newCardsPerDay: number;
  /** New cards already introduced today; only the remainder of the quota is drawn. */
  readonly newIntroducedToday: number;
}

/**
 * A small, deterministic string hash (FNV-1a, 32-bit) — used only to give new
 * cards a fixed order across calls and processes, not for anything security
 * sensitive.
 */
function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Builds one session's queue: every reviewed card due before `dayEndMs`,
 * earliest due first, then new cards up to the day's remaining quota, ordered
 * by level and then by {@link stableHash} of the id so the same input always
 * produces the same queue.
 */
export function buildQueue(input: BuildQueueInput): SessionQueue {
  const { cards, states, dayEndMs, newCardsPerDay, newIntroducedToday } = input;

  const due: { readonly id: string; readonly due: number }[] = [];
  const fresh: Card[] = [];
  for (const card of cards) {
    const state = states.get(card.id);
    if (state === undefined) {
      fresh.push(card);
    } else if (state.due < dayEndMs) {
      due.push({ id: card.id, due: state.due });
    }
  }
  due.sort((a, b) => a.due - b.due);

  const remainingQuota = Math.max(0, newCardsPerDay - newIntroducedToday);
  const newCards = fresh
    .slice()
    .sort((a, b) => {
      const levelDiff = LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level);
      return levelDiff !== 0 ? levelDiff : stableHash(a.id) - stableHash(b.id);
    })
    .slice(0, remainingQuota);

  return [...due.map((entry) => entry.id), ...newCards.map((card) => card.id)];
}

/**
 * Applies the result of one rating to the queue: a card whose new due falls
 * within {@link LEARN_AHEAD_MS} of `nowMs` goes to the end for another pass
 * this session; any other card leaves the queue, since its next review is not
 * today's session's concern.
 */
export function afterRating(
  queue: SessionQueue,
  cardId: string,
  afterDueMs: number,
  nowMs: number,
): SessionQueue {
  const rest = queue.filter((id) => id !== cardId);
  return afterDueMs <= nowMs + LEARN_AHEAD_MS ? [...rest, cardId] : rest;
}

/** Whether `phase` is FSRS's short-interval Learning or Relearning. */
function isLearningPhase(phase: SchedulerPhase): boolean {
  return phase === 1 || phase === 3;
}

/**
 * Whether `cardId` can be studied right now: a new card always can, a
 * review-phase card already qualified as due today, and a learning or
 * relearning card only once its short-interval `due` has arrived.
 */
function isReady(
  cardId: string,
  states: ReadonlyMap<string, SchedulerState>,
  nowMs: number,
): boolean {
  const state = states.get(cardId);
  if (state === undefined) {
    return true;
  }
  return !isLearningPhase(state.state) || state.due <= nowMs;
}

/**
 * The card to study next: the first card in the queue that can be studied
 * now, or — when every remaining card is a learning or relearning card whose
 * short interval has not yet elapsed — the one due soonest anyway, so the
 * session never stalls waiting on a timer. `null` once the queue is empty.
 */
export function nextCard(
  queue: SessionQueue,
  states: ReadonlyMap<string, SchedulerState>,
  nowMs: number,
): string | null {
  if (queue.length === 0) {
    return null;
  }

  const ready = queue.find((id) => isReady(id, states, nowMs));
  if (ready !== undefined) {
    return ready;
  }

  const dueOf = (id: string): number => states.get(id)?.due ?? Number.POSITIVE_INFINITY;
  return queue.reduce((earliest, id) => (dueOf(id) < dueOf(earliest) ? id : earliest));
}
