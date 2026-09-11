# Storage and scheduling

## The database

- **Driver: `node:sqlite`** (`DatabaseSync`), built into Node 24. A spike on 2026-09-11
  (Node 24.18.1, Next 16.3.4 with Turbopack) built and served a Server Component and a
  Route Handler that both used it, with no config change. Vitest ran against `:memory:`,
  and types came from the template's `@types/node`. No warning was printed, though
  `node --help` still lists it as experimental.
  - Rejected: **better-sqlite3.** A mature driver, but a native build, which
    `strictDepBuilds` refuses unless `pnpm-workspace.yaml` gains an `allowBuilds`
    exception.
  - Rejected: **an ORM (Drizzle and similar).** Four tables do not repay a query builder
    and its migration tooling.
- **File:** `.data/english-vocab.sqlite`, gitignored, and overridable through
  `VOCAB_DB_PATH`, which is read in `src/server/env.ts`. Only `src/server/db/` opens it.
  Journal mode is WAL.
- **Migrations:** an ordered list of SQL strings in `src/server/db/migrations.ts`,
  applied on open inside one transaction and tracked by `PRAGMA user_version`. An
  applied migration is never edited; a change is a new entry.
- **Time:** every timestamp is an INTEGER of epoch milliseconds (UTC).

| Table        | Columns                                                                                                                                                                                             | Notes                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `card_state` | `card_id` TEXT PK, `due`, `stability`, `difficulty`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `state`, `last_review`                                                                   | Mirrors ts-fsrs `Card`. No row means the card is new |
| `review_log` | `id` PK, `card_id`, `session_id`, `rating`, `reviewed_at`, `state_before`, `due_before`, `stability_before`, `difficulty_before`, `state_after`, `due_after`, `stability_after`, `difficulty_after` | Append-only; index on `(card_id, reviewed_at)`       |
| `session`    | `id` PK, `started_at`, `ended_at` (null while open), `scope` (JSON), `new_limit`, `remembered_before`, `remembered_after`                                                                           | One row per session                                  |
| `setting`    | `key` TEXT PK, `value` (JSON)                                                                                                                                                                       | `scope`, `newCardsPerDay`                            |

One rating is one transaction: upsert `card_state` and insert `review_log`. Before and
after values are both stored explicitly, taken from the card passed to the scheduler and
the card it returned, so nothing depends on which side ts-fsrs's own log describes. Rows
whose card file is gone or retired are kept and ignored by every count.

`session.scope` records the scope each session ran with. At the four-week check,
`select distinct scope from session` answers whether the owner ever narrowed the scope.

## Scheduling

- **Library: `ts-fsrs`** 5.4.2 (MIT, FSRS-6, no runtime dependencies), imported only by
  `src/core/scheduler.ts`, so swapping it is a bounded edit.
  - Rejected: **implementing FSRS here.** Only reproduces a maintained library.
  - Rejected: **py-fsrs.** It is the same project in the wrong language.
- **Parameters:** the default weights, `request_retention` 0.9, `enable_fuzz` true, and
  short-term scheduling on with the default learning steps (1 min, 10 min) and
  relearning step (10 min). The optimizer (`@open-spaced-repetition/binding`) is not in
  v1; revisit it after several hundred reviews.
- **Day rollover:** 04:00 local time, as in Anki. "Today" runs from the last rollover to
  the next. A card is due today when it has been reviewed and its `due` falls before the
  next rollover.

## The session queue

1. **Start** (`POST /api/sessions`) records the scope and computes `remembered_before`.
   The queue is every due-today card in scope, earliest `due` first. Then come new cards
   in scope, up to `newCardsPerDay` minus the cards whose first review happened today,
   ordered by level ascending, then by a stable hash of the id.
2. **Answer:** front → reveal → rating → `scheduler.next` → persist. When the card's new
   `due` is within 20 minutes (Anki's learn-ahead), it goes back to the end of the
   queue. When only such cards remain, the earliest one is shown without waiting.
3. **End:** the queue is empty or the owner ends early. `remembered_after` is computed.
   The summary shows the session's `review_log` count and the change in remembered now.

A closed tab loses nothing, since every rating is already stored. Reopening starts a new
session. The new-card limit is **per day, not per session** (Anki's meaning), so a
second session on the same day does not draw ten more.

## Scope

`{ purpose: "ielts", topics: TopicId[], target: null | { exam: "ielts", score } }`, with
empty `topics` meaning all. A card is in scope when it is not retired, its `purposes`
include the purpose, `topics` is empty or overlaps the card's topics, and the target is
null or the card's level is one of the target's levels. Target levels are the score's
CEFR level plus the one below it (IELTS 7.0 → C1 → B2 and C1).

IELTS → CEFR, self-declared and read off IELTS's own comparison page, which says its
boundaries are blurred: 4.0–5.0 → B1, 5.5–6.5 → B2, 7.0–8.0 → C1, 8.5–9.0 → C2. The UI
offers 4.0–9.0 in 0.5 steps. The table lives in `src/core/scope.ts`. Research:
braintrust `research/exam-cefr-mapping.md`.

## Progress

- **R(card, t)** is the FSRS forgetting curve evaluated from the card's last review at
  or before `t`, using that review's `stability_after` and `reviewed_at`.
- **Remembered now** = Σ R(card, now) over reviewed, non-retired cards in scope. The
  display rounds it to an integer.
- **Unlearned** is the count of in-scope cards with no review.
- **Target ratio** = remembered now over the target scope, divided by the number of
  cards in that scope. Shown only when a target is set; no score is ever estimated.
- **Daily curve:** one point per day at the rollover, from the first review to today,
  with today's point taken at _now_. It is recomputed from `review_log` on every render.
  It is never snapshotted.
  - Why: the curve has to follow any scope, including one never selected before. A
    snapshot only knows the scopes that happened to be recorded. The cost is cards ×
    days evaluations of a closed-form curve (3,000 cards × 365 days ≈ 1.1M), which is
    trivial locally.
  - Rejected: **a daily snapshot table.** Cheap to read, but blind to any scope nobody
    was looking at that day.
  - Accepted consequence: if the FSRS parameters ever change (the optimizer), past
    points move too.
