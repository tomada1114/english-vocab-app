"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import type { Rating } from "../../../core/scheduler";
import { useRouter } from "../../../i18n/navigation";
import {
  endSession,
  recordReview,
  startSession,
  RATINGS,
  type OpenSession,
} from "./session-api";

/**
 * The study loop: one card's front, its back, and the rating that moves on.
 *
 * @remarks
 * The only Client Component this application ships, and the smallest file that
 * has to be one: it owns the queue, the reveal, a window keydown listener and
 * the navigation away at the end. The page above it stays a Server Component.
 *
 * The queue is kept here rather than re-asked for after every rating. The
 * server already answered with every card's front and back, so revealing costs
 * no request, and `requeue` in a rating's answer is what decides whether the
 * card goes back to the end of it — the 20-minute learn-ahead rule stated once,
 * in `src/core/session.ts`, and read from both sides of the request.
 *
 * A rating that fails leaves the card where it is and shows the failure: the
 * alternative is advancing past a card whose answer was never recorded.
 */
export function StudySession(): ReactElement {
  const t = useTranslations("StudyPage");
  const router = useRouter();
  const [session, setSession] = useState<OpenSession | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [failed, setFailed] = useState(false);

  const finish = useCallback(
    async (sessionId: number): Promise<void> => {
      // Every rating is already stored, so a failed end is not worth stranding
      // the reader on a dead screen for: the summary reads what is there.
      await endSession(sessionId).catch(() => undefined);
      router.push(`/sessions/${String(sessionId)}`);
    },
    [router],
  );

  // One session per visit, whatever re-renders: a second POST would open a
  // second session row and study the same cards twice.
  const opening = useRef(false);

  useEffect(() => {
    if (opening.current) {
      return;
    }
    opening.current = true;
    startSession()
      .then(async (started) => {
        if (started.queue.length === 0) {
          await finish(started.sessionId);
          return;
        }
        setSession(started);
      })
      .catch(() => {
        setFailed(true);
      });
  }, [finish]);

  const current = session?.queue[0];

  const submit = useCallback(
    async (rating: Rating): Promise<void> => {
      if (session === null || current === undefined) {
        return;
      }
      const { requeue } = await recordReview(session.sessionId, current.cardId, rating);
      const rest = session.queue.slice(1);
      const queue = requeue ? [...rest, current] : rest;
      setRevealed(false);
      if (queue.length === 0) {
        await finish(session.sessionId);
        return;
      }
      setSession({ sessionId: session.sessionId, queue });
    },
    [session, current, finish],
  );

  const rate = useCallback(
    (rating: Rating): void => {
      submit(rating).catch(() => {
        setFailed(true);
      });
    },
    [submit],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        if (session !== null) {
          void finish(session.sessionId);
        }
        return;
      }
      if (!revealed) {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          setRevealed(true);
        }
        return;
      }
      const rating = RATINGS.find((candidate) => candidate.key === event.key);
      if (rating !== undefined) {
        rate(rating.value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [revealed, session, rate, finish]);

  if (failed) {
    return <p role="alert">{t("error")}</p>;
  }
  if (session === null || current === undefined) {
    return <p>{t("loading")}</p>;
  }

  return (
    <section>
      <p>{t("remaining", { count: session.queue.length })}</p>
      <p>{current.definition}</p>
      <p>{current.cloze}</p>
      {revealed ? (
        <div>
          <h2>{current.headword}</h2>
          <ul>
            {current.examples.map((example) => (
              <li key={example}>{example}</li>
            ))}
          </ul>
          {RATINGS.map((rating) => (
            <button
              key={rating.key}
              type="button"
              onClick={() => {
                rate(rating.value);
              }}
            >
              {t(rating.label)}
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setRevealed(true);
          }}
        >
          {t("reveal")}
        </button>
      )}
      <p>{t("hint")}</p>
    </section>
  );
}
