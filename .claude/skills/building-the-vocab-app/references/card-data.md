# Card data

## A card

One file, `data/cards/<id>.json`, formatted by Prettier:

```json
{
  "id": "mitigate--verb",
  "headword": "mitigate",
  "pos": "verb",
  "level": "C1",
  "purposes": ["ielts"],
  "topics": ["environment", "health"],
  "definition": "to make something bad less serious or less harmful",
  "cloze": "Planting trees along rivers can help ___ the effects of flooding.",
  "examples": [
    "The company hired lawyers to mitigate the damage to its name.",
    "Rest and plenty of water can mitigate a mild headache."
  ]
}
```

| Field        | Type                                             | Rule                                                                            |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `id`         | string                                           | Equals `cardId(headword, pos)` and the file name without `.json`                |
| `headword`   | string                                           | The answer, shown on the back. One word in v1; at most 5 words later            |
| `pos`        | `noun` \| `verb` \| `adjective` \| `adverb`      | Closed; phrase kinds are added when phrases arrive                              |
| `level`      | `A1` … `C2`                                      | Self-declared                                                                   |
| `purposes`   | non-empty array of ids from `data/purposes.json` | Multi-valued                                                                    |
| `topics`     | non-empty array of ids from `data/topics.json`   | Multi-valued                                                                    |
| `definition` | string                                           | English. A1–A2 wording (B1 at most) is authoring guidance, not checked          |
| `cloze`      | string                                           | Exactly one `___`; any inflected form may fill it                               |
| `examples`   | two strings                                      | Each uses the headword, in a different scene from the cloze and from each other |
| `retired`    | `true`, optional                                 | Absent means active                                                             |

The zod schema in `src/core/cards/card.ts` is strict: an unknown key is an error. The
front is `definition` + `cloze`; the back is `headword` + `examples`. There is no
Japanese field and no pronunciation field.

Each part stays its own field, never one joined text: a future read-aloud setting
(browser speech or an API) can then speak only the headword, or each example in turn. A
screen or an API response composes the parts; only the Anki export joins them.

**Id.** `cardId(headword, pos) = slug(headword) + "--" + pos`, where `slug` lowercases
and collapses every run of characters outside `[a-z0-9]` into one `-`, trimmed at both
ends. `("carbon footprint", "noun")` → `carbon-footprint--noun`.

**Lists.** `data/topics.json` holds the 15 topic ids: education, work, business-economy,
science-technology, environment, health, media-advertising, travel-tourism,
cities-housing, crime-law, government-society, family-relationships, culture-arts, food,
sport-leisure. `data/purposes.json` holds `ielts`. To add one, edit the list file. The
Lint rejects anything else, because the point of a fixed list is to stop spelling drift.

## Why one file per card

A card carries several topics, so a per-topic file has no single home for it. Per-card
files keep generation append-only, make every diff card-sized, and let two branches add
cards without a merge conflict.

- Rejected: **one file for everything.** Every generation run rewrites one large file,
  and two branches always conflict.
- Rejected: **one file per topic.** A card tagged `environment` and `health` belongs in
  neither file alone.
- Rejected: **one file per generation batch.** Adding a topic tag to an existing card
  then edits an old batch file, and a card's location stops meaning anything.

## Changing a card

- **A text fix** (definition, cloze, an example, tags, level): overwrite the same file.
  The id is unchanged, so the card's FSRS state and history carry over. Read the change
  with `git diff`.
- **A new answer word:** the key changes, so it is a new card. Set `"retired": true` on
  the old file and keep it. Its id stays reserved, its history stays in SQLite, and it
  drops out of sessions, remembered now, the unlearned count, and every other total.
- **An existing card that fits a new topic** gets the tag added. It is not duplicated.

## The Lint

Rules live in `src/core/cards/lint.ts` and the `lint-*.ts` modules beside it — the
per-file size budget in `eslint.config.mjs` is what splits them, with `lint.ts` holding
the entry point and the rules that have to see the whole directory — and every threshold
lives in `src/core/cards/lint-config.ts`, the one place to change a number. The rules
are ported from `tomada-routine`'s
`.claude/skills/anki-vocabulary/scripts/validate_phrase_cards.py` (and its `config.py`)
without the `gloss_ja` rules: stemming, irregular verbs, placeholder words, echo
fragments of at least 8 characters. `ERROR` fails; `WARN` is reported and passes.

| Rule                       | Severity | Fires when                                                           |
| -------------------------- | -------- | -------------------------------------------------------------------- |
| `E_SCHEMA`                 | ERROR    | The file fails the zod schema (includes empty strings)               |
| `E_ID_MISMATCH`            | ERROR    | `id` ≠ `cardId(headword, pos)`, or the file name ≠ `id`              |
| `E_DUPLICATE_KEY`          | ERROR    | Two files share a key, retired ones included                         |
| `E_UNKNOWN_TOPIC`          | ERROR    | A topic is not in `data/topics.json`                                 |
| `E_UNKNOWN_PURPOSE`        | ERROR    | A purpose is not in `data/purposes.json`                             |
| `E_FORBIDDEN_MARK`         | ERROR    | Any field contains `...` or `…`                                      |
| `E_HAS_CJK`                | ERROR    | Any field contains CJK characters                                    |
| `E_CLOZE_BLANK`            | ERROR    | `cloze` does not contain exactly one `___`                           |
| `E_ANSWER_LEAK`            | ERROR    | `definition` or `cloze` contains the headword or an inflection of it |
| `E_EXAMPLE_MISSING_ANSWER` | ERROR    | An example uses none of the headword's content words                 |
| `E_EXAMPLE_ECHOES_CLOZE`   | ERROR    | An example is the cloze with the blank filled in                     |
| `E_EXAMPLES_IDENTICAL`     | ERROR    | The two examples are the same text                                   |
| `E_FRONT_TOO_LONG`         | ERROR    | `definition` + `cloze` > 40 words                                    |
| `E_CLOZE_TOO_LONG`         | ERROR    | `cloze` > 20 words                                                   |
| `E_HEADWORD_TOO_LONG`      | ERROR    | `headword` > 5 words                                                 |
| `E_EXAMPLE_TOO_LONG`       | ERROR    | An example > 12 words                                                |
| `W_EXAMPLE_PARTIAL_ANSWER` | WARN     | An example uses only some of a multi-word headword                   |
| `W_EXAMPLE_LONGISH`        | WARN     | An example > 8 words. Drop this rule if it fires on most cards       |

`E_SCHEMA` also covers what the zod schema cannot: a file the loader could not read as a
card at all (unreadable, or not JSON), and a field holding only whitespace, which
`min(1)` accepts as text.

Judgment is not the Lint's job: whether the front has one answer, whether a paraphrase
leaks it, whether an example is natural. That belongs to `reviewing-cards`.

**Where it runs.** `src/server/card-lint.ts` is the one entry point that reads a
directory: `lintDataDirectory(dataDirectory)` loads it through `src/server/cards.ts` and
lints what came back. Unit tests drive the rules over cards built in
`tests/card-lint.test.ts`, never over a fixture tree — `lintCards` takes cards, so a
file between a rule and its case would only add a loader to debug.
`tests/card-data.test.ts` (in the `automation` project) loads the real `data/` tree,
fails on any ERROR and prints every WARN, so CI blocks a pull request that adds a bad
card. `pnpm cards:lint` runs only that suite; the generating skill calls it. Card text
is also spell-checked by the Typos workflow: a false positive goes into `typos.toml`,
and `data/` is never excluded.

**Why TypeScript in `core`.** The app, the loader and the Lint then share one schema, CI
gates card data with no extra step, and the zone rules and coverage floor apply.

- Rejected: **a Python port of the reference.** Least porting work, but a second copy of
  the schema, a second language, and no CI step.
- Rejected: **a `scripts/*.mjs` validator.** Repository scripts may import only `node:*`
  builtins, so it could not reuse the zod schema and would duplicate it.
