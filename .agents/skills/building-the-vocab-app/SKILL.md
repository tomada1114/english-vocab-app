---
name: building-the-vocab-app
description: >
  Covers this app's domain and settled design: card JSON under data/cards/ and its
  schema, the topic and purpose lists, the card Lint, the SQLite store under .data/,
  FSRS scheduling through ts-fsrs, the study session queue, scope filtering, the
  remembered-now number and the daily curve, and the home, study and summary screens.
  Use when adding or changing card data or its schema, the Lint, a table or migration,
  scheduling or session logic, a progress number, or a screen, or when asking why the
  app deviates from the template.
---

# Building the Vocab App

**Owns:** the product vocabulary and the decisions specific to this app, cut from
`nextjs-app-template`. **Does not own:** zone boundaries and the Route Handler shape
(`building-app-routes`), the catalog mechanics (`localizing-ui`), error-code naming
(`designing-errors`), the procedure for reviewing a batch of cards (`reviewing-cards`),
and the procedure for writing one (the `generating-cards` skill, once it exists).

This repository keeps no `docs/` tree. This skill and its references are the design of
record: a change to a decision here is made in the same pull request that changes the
code.

## What the app is

A personal, local-only flashcard app, replacing Anki for the owner's English vocabulary.
Pick a scope (purpose, topics, target level), read a card's front (an English definition
plus a sentence with the answer blanked as `___`), recall the word, flip to the back
(the word plus two example sentences), and rate recall as Again / Hard / Good / Easy.
FSRS decides when the card comes back. No LLM is called at runtime. AI is used only
offline, by two skills that write and review the card data.

It adds three things over Anki, and nothing else: its own look and controls, narrowing
by purpose, topic and target level, and progress shown inside the study flow. No
streaks, points, or score estimates.

## Vocabulary

| Term           | Meaning                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| Card           | One JSON file under `data/cards/`; the unit that is scheduled. Shape: [card-data.md](references/card-data.md) |
| Key            | `(headword, pos)`; one card per key. Senses are not split                                                     |
| Card id        | Derived from the key, e.g. `carbon-footprint--noun`; also the file name                                       |
| Purpose        | An exam or goal a word serves (`ielts` only in v1); a card carries one or more                                |
| Topic          | One of the 15 fixed ids in `data/topics.json`; a card carries one or more                                     |
| Level          | Self-declared CEFR, `A1`–`C2`, one per card                                                                   |
| Target         | An exam score, converted to CEFR; selects that level and the one below                                        |
| Scope          | Purpose × topics × target, as selected on the home screen; every number follows it                            |
| Due today      | A reviewed card whose `due` falls before the next rollover (04:00 local)                                      |
| New card       | A card with no review yet; at most `newCardsPerDay` (default 10) are introduced per day                       |
| Session        | One pass: every card due today in scope, then the day's remaining new cards                                   |
| Remembered now | Σ recall probability R over reviewed, non-retired cards in scope, rounded                                     |
| Retired card   | `"retired": true`; kept on disk and in history, excluded from sessions and every count                        |

## Core loop

Home (scope, due-today count, remembered now, unlearned count, target ratio, daily
curve) → Start → front → reveal → rate 1–4 → next card, with Again/learning cards coming
back within the same session → the queue empties or the owner ends early → summary
("reviewed M, remembered +N", today's point on the curve) → Home. Screens and routes:
[screens-and-pipeline.md](references/screens-and-pipeline.md).

## Where things live

```
data/                    # vocabulary data, separable from the app logic
├── cards/<id>.json      # one card per file
├── topics.json          # the fixed topic list; extended only by editing it
└── purposes.json        # the purpose list (`ielts`)
src/core/cards/          # card schema + id derivation, the Lint and its thresholds
src/core/                # scope, scheduler (sole ts-fsrs importer), session queue, progress math
src/server/cards.ts      # the only reader of data/
src/server/db/           # the only opener of the SQLite file; migrations; queries
src/server/handlers/     # Web-standard handlers behind the Route Handlers
src/app/[locale]/        # home, study, and summary pages
.data/                   # the SQLite file (gitignored); override with VOCAB_DB_PATH
```

`data/` plus `src/core/cards/` is the part a future vocabulary library would lift out.
Nothing else reads `data/`, and the schema imports nothing from above `core`.

## Settled decisions

The rationale and the rejected options are in the references. In brief:

- **Cards:** one file per card, a strict zod schema, and ids derived from the key.
  Unknown topics and purposes are errors. Text fixes overwrite the same id and keep its
  FSRS state; a change of answer word is a new card plus a retired old one.
  [card-data.md](references/card-data.md)
- **Lint:** TypeScript in `src/core/cards/`, ported from the reference validator, with
  thresholds in one config module. A test lints the real `data/` tree, so CI blocks any
  ERROR; `pnpm cards:lint` runs just that test. [card-data.md](references/card-data.md)
- **Storage:** Node's built-in `node:sqlite` with no native dependency. Four tables:
  `card_state`, `review_log` (append-only, before and after values), `session`
  (including the scope it ran with) and `setting`.
  [storage-and-scheduling.md](references/storage-and-scheduling.md)
- **Scheduling:** `ts-fsrs` with default parameters, retention 0.9, fuzz on, and
  short-term learning steps. The daily new-card limit defaults to 10, and the day rolls
  over at 04:00 local. [storage-and-scheduling.md](references/storage-and-scheduling.md)
- **Progress:** remembered now and the daily curve are recomputed from `review_log` for
  whatever scope is selected. No daily snapshots.
  [storage-and-scheduling.md](references/storage-and-scheduling.md)
- **Card pipeline:** `generating-cards` and `reviewing-cards` live in this repository.
  Running them is the owner's own work, never an automated issue.
  [screens-and-pipeline.md](references/screens-and-pipeline.md)

## Deviations from the template

- **No AI layer.** It was removed whole at setup; the app makes no model call.
- **A local database.** SQLite through `node:sqlite`, so the app is Node-only and never
  runs on an edge runtime. No `allowBuilds` entry was needed.
- **A `data/` tree** at the root, holding committed vocabulary data.
- **English only.** The `ja` catalog was dropped at setup; card content is English by
  design.
- **Local only.** `dev` and `start` bind to 127.0.0.1. No authentication, no rate limit,
  no deployment. Revisit all three together if the app is ever deployed.

## Not decided

- When to run the FSRS optimizer (after several hundred reviews at the earliest).
- When, if ever, to add retention tiers (unlearned / learning / mature) or milestone
  effects. Decide after using the app.
- The identity key for phrases and idioms, and whether `pos` gains phrase values.
- Where the blind-answer check draws the line on a "plausible other answer" (inflection,
  register). Tuned after the first batch.
- Undo of the last rating, and backing up `.data/`. Neither is in the first version.

## Planning history

Planned in the `braintrust` repository, `docs/plan/english-vocab-app/` (handoff dated
2026-09-11). Its `decisions.md` holds the product decisions this skill builds on and the
rejected options behind them. The reference card pipeline is `tomada-routine`'s
`.claude/skills/anki-vocabulary/` and `.claude/skills/anki-router/references/`.
