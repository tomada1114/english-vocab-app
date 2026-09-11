---
name: reviewing-cards
description: >
  Covers the independent review of a batch of vocabulary cards under data/cards/: a
  blind-answer run that is shown only the definition and the cloze and lists every word
  that fits, and a perspective run covering a paraphrase that leaks the answer, example
  quality, an example that is the cloze reworded, two overlapping examples, and a
  synonym duplicating an existing card. Use when reviewing generated cards, running
  either lens, reading or merging its FIX and DROP verdicts, or calling this review from
  a card-generation run.
---

# Reviewing Cards

**Owns:** the two review lenses over a batch of cards, what each run is handed, the
verdict vocabulary it returns, and who decides. **Does not own:** the card schema, the
fields, and the mechanical Lint (`building-the-vocab-app`); how a card is written in the
first place (the `generating-cards` skill, once it exists); where a test file goes
(`placing-tests`).

The mechanical Lint sees only shape. Whether a front has exactly one answer, whether a
paraphrase gives it away, whether an example is a sentence anyone would say — none of
that is a rule a checker can hold. It is this skill's subject.

## Why the review is a separate run

**A session that wrote the cards finds almost nothing wrong with them.** In the
reference project this doctrine comes from, a 471-line checklist was applied by the same
context that had written the batch: one of its own criteria was stated correctly, and 25
of 196 cards still went through violating it. Reviewing your own work is the failure,
not the checklist.

So each lens runs as **an independent run — a sub-agent, or a fresh session with no
history of the batch**:

- **Never pass the author's intent.** Not why a word was chosen, not what the generation
  run was asked for, not which cards were already fixed once. The moment any of it
  crosses over, the review is self-review again. The _purpose_ of the review may be
  passed — that its findings decide what lands in `data/cards/` — because what causes
  self-review is intent, not purpose.
- **Ask for violations, not for confirmation.** "List every card that breaks a criterion
  below" gets a review; "check whether these cards are all right" gets agreement.
- **Pass the criterion text, never only its name.** A run handed "the disguised-echo
  criterion" does not know what that is. Paste the section, or hand over the whole
  reference file.

## What each run is handed

| Run                | Card fields                                            | Also                   |
| ------------------ | ------------------------------------------------------ | ---------------------- |
| Blind answer       | `definition`, `cloze`                                  | nothing else           |
| Perspective review | `definition`, `cloze`, `headword`, `examples`, `level` | the existing card list |

The existing card list is every card already under `data/cards/`, retired ones included,
as headword plus definition. It is what the duplicate-synonym criterion is checked
against.

**Label cards by position, never by card id.** A card id is
`slug(headword) + "--" + pos`, so handing one to the blind-answer run hands over the
answer. Number the batch `c1` … `cN` instead, and keep the mapping back to the real ids
in the calling session. Both runs receive the same cards in the same order, so a finding
under `c3` means the same card in both — which is what lets their verdicts merge.

## The two lenses

- **Blind answer** — is there exactly one word that fits this front?
  [blind-answer.md](references/blind-answer.md)
- **Perspective review** — five criteria over the whole card and the existing deck.
  [perspective-review.md](references/perspective-review.md)

**Run both on every batch, whatever its size.** One card still goes through both. An
exception for a small batch is how a review step stops happening at all.

Neither lens re-reports what the Lint already blocks: a literal answer leak, an example
with none of the headword's content words, an example that is the cloze with the blank
filled, two identical examples, a length overrun. Each lens looks at what survives
those.

## The output shape

Each run returns **only the cards that fail**, as one JSON object. Returning every card
buries the findings in a wall of passes.

| Field                | Where                 | Meaning                                                         |
| -------------------- | --------------------- | --------------------------------------------------------------- |
| `lens`               | top level             | `blind-answer` or `perspective-review`                          |
| `findings`           | top level             | One entry per failing card; `[]` when the batch is clean        |
| `answers`            | top level, blind only | Every card's fitting-word list, failing or not                  |
| `id`                 | finding               | The batch label, `c1` … `cN`                                    |
| `verdict`            | finding               | `FIX` or `DROP`                                                 |
| `confidence`         | finding               | `high`, `medium` or `low`                                       |
| `reason`             | finding               | What the card violates, in one sentence                         |
| `suggest_definition` | `FIX` only            | A replacement definition, or `null`                             |
| `suggest_cloze`      | `FIX` only            | A replacement cloze, or `null`                                  |
| `suggest_examples`   | `FIX` only            | Two entries, `null` in each slot that stays, or `null` for both |

A `FIX` carries all three `suggest_*` keys, `null` where it has nothing to propose — an
absent key and a null one would otherwise be indistinguishable in a merge. A `DROP`
carries none: there is nothing to fix.

`confidence` is what the deciding session weighs. Since both verdicts are advice, a
finding without one leaves no way to treat a borderline card differently from a certain
one.

A blind-answer run also returns `answers`, because the run does not know the headword
and cannot judge "any answer other than the headword" for itself. The list is the
evidence; the comparison is the caller's.

```json
{
  "lens": "blind-answer",
  "answers": [
    { "id": "c1", "words": ["mitigate", "reduce", "lessen", "ease"] },
    { "id": "c2", "words": ["commute"] }
  ],
  "findings": [
    {
      "id": "c1",
      "verdict": "FIX",
      "confidence": "high",
      "reason": "four words fit the definition and read naturally in the blank; nothing in the front chooses between them",
      "suggest_definition": "to make something harmful less serious, especially a risk someone is responsible for",
      "suggest_cloze": "New flood defences will ___ the risk to homes near the river.",
      "suggest_examples": null
    }
  ]
}
```

```json
{
  "lens": "perspective-review",
  "findings": [
    {
      "id": "c4",
      "verdict": "DROP",
      "confidence": "high",
      "reason": "the existing card for journey--noun has the same sense at the same level, and neither definition distinguishes them"
    }
  ]
}
```

## Merging, and who decides

- **`DROP` beats `FIX`** when both lenses report the same card.
- Two `FIX` suggestions for the same field: take the blind-answer one for `definition`
  and `cloze`, since narrowing the front is the question that lens exists to answer.
- **`DROP` is advice, not a decision.** So is `FIX`, and so is every suggested string in
  it. The calling session decides what is written to `data/cards/`.
- **Report every overturned verdict to the owner, with the reason.** A kept `DROP`, a
  `FIX` applied differently from the suggestion — each one is named in the summary of
  the run. Without that, nobody can notice the review has become a rubber stamp, which
  is the state it decays into silently.
- Apply the merged verdicts to the card files, then run the card Lint again: a
  hand-applied definition or cloze can break a mechanical rule the original passed.
