# Screens and the card pipeline

## Screens

Concept level only: what each screen holds and where it leads. Visual design is not
settled here.

```
/en  Home ──Start──▶ /en/study ──queue empty or Esc──▶ /en/sessions/[id]  Summary
  ▲                                                          │
  └──────────────────────────── Home ◀───────────────────────┘
```

**Home** (`/[locale]`, Server Component, reads through `src/server/`)

- Scope controls: purpose, topics (multi-select chips; none means all), target score
  (none, or IELTS 4.0–9.0), new cards per day. Saved to `setting.scope` and
  `setting.newCardsPerDay` on change.
- Due today in scope, which is the daily reason to open the app. Remembered now as an
  integer, with the unlearned count beside it. Target ratio as a percentage, when a
  target is set.
- The daily curve for the scope, drawn as inline SVG with no chart dependency.
- Start. When nothing is due and no new card is left, Start is disabled and the page
  says nothing is due today. With no cards in `data/` at all, it points to the
  `generating-cards` skill.

**Study** (`/[locale]/study`, a Client Component)

- On mount it calls `POST /api/sessions`, which returns the session id and the queue,
  each item carrying its front and back.
- Front: the definition and the cloze. Space or Enter reveals the back: the headword and
  both examples. Keys 1–4 rate it (Again / Hard / Good / Easy), and each rating is a
  `POST /api/sessions/[id]/reviews` with `{ cardId, rating }`. The response says whether
  the card comes back within this session.
- A remaining-count indicator. Esc ends the session early.
- `POST /api/sessions/[id]/end` closes the session, then the page moves to the summary.

**Summary** (`/[locale]/sessions/[id]`, Server Component)

- "Reviewed M cards · remembered +N (before → after)".
- The same curve as Home, with today's point marked.
- Back to Home.

Every Route Handler is a one-line re-export of a `create<Name>Handler(dependencies)`
factory in `src/server/handlers/`, per `building-app-routes`. The handlers trust no
input: card ids and ratings are validated with zod.

## The card pipeline

Card data is written and reviewed by two skills in this repository. They run in an
interactive agent session, never at runtime.

**`generating-cards`** takes a purpose, a topic, a CEFR range, and a count.

1. List the existing keys: the file names in `data/cards/`, retired ones included.
   Instruct the model to exclude them.
2. Write new card files. When an existing card fits the topic, propose adding the topic
   tag to it instead of writing a duplicate.
3. Run `pnpm fix`, then `pnpm cards:lint`. Repeat until there is no ERROR.
4. Run `reviewing-cards`, apply its verdicts, and lint again.
5. The owner reads the diff and merges it through their own pull request.

The card-writing rules live in the skill's references. They are adapted from
`tomada-routine`'s `phrase-design-rules.md` P1–P8, minus everything about Japanese. Its
grounding rule (P5) becomes "a word a candidate at this level actually meets in this
topic".

**`reviewing-cards`** is two independent runs. Neither run is told why a card was
written, only the criteria and the cards.

- **Blind answer:** shown only the front, the reviewer lists every word that fits.
  Another plausible answer makes the card a FIX, with a suggested note or collocation
  that narrows it.
- **Perspective review:** a paraphrase that leaks the answer, example quality, an
  example that is the cloze reworded, the two examples overlapping each other, and a
  synonym that duplicates an existing card.
- Each run returns only the cards that fail, as FIX or DROP with a confidence and a
  reason, in the JSON shape of `tomada-routine`'s `short-form-review.md`. DROP is
  advice; the calling session decides. Every overturned verdict is reported to the owner
  with its reason. Both runs happen on every batch, whatever its size.

Its source doctrine is `tomada-routine`'s `anki-router/references/review-doctrine.md`.

## Why generating cards is not an issue

Every card's quality is a judgment the owner makes by reading it, and `shipping-issues`
merges on green CI with no approval pause. The two do not mix, so the work is split:

- **Issues build the pipeline:** the schema, the Lint, the two skills, and the app. Each
  one closes on tests, and none produces card content.
- **The owner runs the pipeline.** The first batch (environment, education and health,
  about 30 cards each, IELTS, B2–C1) is tracked by an issue labeled `on hold`, which
  shipping-issues treats as not ready and never picks up. The owner closes it with their
  own pull request.
- Rejected: **a staging directory** that shipping-issues fills and the owner promotes
  later. It would put unread content on `main` and add a promotion step and a second
  card state, for no gain over the owner running the skill directly.
