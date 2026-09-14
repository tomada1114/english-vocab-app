---
name: reviewing-cards
description: >
  Covers the independent review of a batch of vocabulary cards under data/cards/: a
  blind-answer run shown only the definition and the cloze, a perspective run over the
  whole card and the deck, an adjudication run that re-checks every verdict the calling
  session overturned, and a level-and-selection run over the batch's word list. Use when
  reviewing generated cards, running any lens, reading or merging its verdicts, deciding
  whether an override stands, or calling this review from a card-generation run.
---

# Reviewing Cards

**Owns:** the review lenses over a batch of cards, what each run is handed, the verdict
vocabulary it returns, and who decides. **Does not own:** the card schema, the fields,
and the mechanical Lint (`building-the-vocab-app`); how a card is written in the first
place (`generating-cards`); where a test file goes (`placing-tests`).

The mechanical Lint sees only shape. Whether a front has exactly one answer, whether a
paraphrase gives it away, whether an example is a sentence anyone would say, whether the
word was worth a card at all — none of that is a rule a checker can hold. It is this
skill's subject.

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

**The same failure returns at the merge.** Findings come back, and the calling session
decides which to accept — and it is the session that wrote the cards. Everything the
separate runs bought is spent again there. That is what the adjudication lens is for,
and it is why the loop closes only after it has run.

## What each run is handed

| Run                 | Card fields                                            | Also                          |
| ------------------- | ------------------------------------------------------ | ----------------------------- |
| Blind answer        | `definition`, `cloze`                                  | nothing else                  |
| Perspective review  | `definition`, `cloze`, `headword`, `examples`, `level` | the existing card list        |
| Adjudication        | `definition`, `cloze`, `headword`, the rival named     | the rival rule, if one is set |
| Level and selection | `headword`, `pos`, `level`, `topics`, `definition`     | what the learner is doing     |

The existing card list is every card already under `data/cards/`, retired ones included,
as headword plus definition. It is what the duplicate-synonym criterion is checked
against.

**Label cards by position, never by card id.** A card id is
`slug(headword) + "--" + pos`, so handing one to the blind-answer run hands over the
answer. Number the batch `c1` … `cN` instead, and keep the mapping back to the real ids
in the calling session. Every run receives the same labels for the same cards, which is
what lets their verdicts merge.

## The lenses

Two read the cards, one reads the calling session's judgment, one reads the word list.

- **Blind answer** — is there exactly one word that fits this front?
  [blind-answer.md](references/blind-answer.md)
- **Perspective review** — five criteria over the whole card and the existing deck.
  [perspective-review.md](references/perspective-review.md)
- **Adjudication** — were the verdicts the calling session overturned actually wrong?
  [adjudication.md](references/adjudication.md)
- **Level and selection** — is this batch worth the learner's review time?
  [level-and-selection.md](references/level-and-selection.md)

**Run all four on every batch, whatever its size.** One card still goes through them
all. An exception for a small batch is how a review step stops happening at all. The one
lens that can be skipped is adjudication, and only when the calling session overturned
nothing — which is itself worth a second look.

The first two run together, on the batch as written. The last two run after their
verdicts have been applied, on the cards that are actually going to ship.

Neither of the first two re-reports what the Lint already blocks: a literal answer leak,
an example with none of the headword's content words, an example that is the cloze with
the blank filled, two identical examples, a length overrun. Each lens looks at what
survives those.

## The output shape

Each run returns **only the cards that fail**, as one JSON object. Returning every card
buries the findings in a wall of passes. The two exceptions are a run's evidence for the
cards it passed: the blind lens's `answers`, and the adjudication lens's `rulings`.

| Field                | Where                        | Meaning                                                         |
| -------------------- | ---------------------------- | --------------------------------------------------------------- |
| `lens`               | top level                    | Which lens produced this                                        |
| `findings`           | top level                    | One entry per failing card; `[]` when the batch is clean        |
| `answers`            | top level, blind only        | Every card's fitting-word list, failing or not                  |
| `rulings`            | top level, adjudication only | Every overridden card's ruling, reversed or not                 |
| `missing`            | top level, selection only    | Words the batch needs and does not have                         |
| `verdict`            | top level, selection only    | The batch judged as a whole, in one paragraph                   |
| `id`                 | finding                      | The batch label, `c1` … `cN`                                    |
| `verdict`            | finding                      | `FIX` or `DROP`                                                 |
| `confidence`         | finding                      | `high`, `medium` or `low`                                       |
| `reason`             | finding                      | What the card violates, in one sentence                         |
| `suggest_definition` | `FIX` only                   | A replacement definition, or `null`                             |
| `suggest_cloze`      | `FIX` only                   | A replacement cloze, or `null`                                  |
| `suggest_examples`   | `FIX` only                   | Two entries, `null` in each slot that stays, or `null` for both |

Every lens uses the same `FIX`/`DROP` finding vocabulary, so verdicts from four runs
merge without translation. A `FIX` carries all three `suggest_*` keys, `null` where it
has nothing to propose — an absent key and a null one would otherwise be
indistinguishable in a merge. A `DROP` carries none: there is nothing to fix.

`confidence` is what the deciding session weighs. Since most verdicts are advice, a
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

```json
{
  "lens": "adjudication",
  "rulings": [
    {
      "id": "c7",
      "ruling": "UPHELD",
      "distinction": "NONE",
      "first_answer": "compulsory"
    },
    {
      "id": "c9",
      "ruling": "REVERSED",
      "distinction": "a relapse is a person sliding back after improving; a recurrence is the illness itself reappearing",
      "first_answer": "recurrence"
    }
  ],
  "findings": [
    {
      "id": "c9",
      "verdict": "FIX",
      "confidence": "high",
      "reason": "the definition is a gloss of the rival rather than of the answer, so the learner produces the rival first",
      "suggest_definition": "a slide back into an illness someone had seemed to recover from",
      "suggest_cloze": null,
      "suggest_examples": null
    }
  ]
}
```

```json
{
  "lens": "level-and-selection",
  "missing": [
    {
      "headword": "alleviate",
      "pos": "verb",
      "reason": "the highest-yield solution verb across all three topics, and nothing in the deck does that job"
    }
  ],
  "verdict": "a topic glossary rather than an essay-writing toolkit: the nouns are strong, but sixty nouns against eleven verbs leave the learner able to name what an argument is about and unable to say what should be done about it",
  "findings": [
    {
      "id": "c2",
      "verdict": "DROP",
      "confidence": "high",
      "reason": "a transparent compound of two A1 words, known well before the batch's floor, so every review of it is a wasted repetition"
    }
  ]
}
```

## Merging, and who decides

- **`DROP` beats `FIX`** when two lenses report the same card.
- Two `FIX` suggestions for the same field: take the blind-answer one for `definition`
  and `cloze`, since narrowing the front is the question that lens exists to answer.
- A level-and-selection `DROP` beats a perspective-review `DROP` on the same card: one
  says the word does not earn its slot, the other only that it resembles a neighbour.
- **Apply the merged verdicts, then run the card Lint again**: a hand-applied definition
  or cloze can break a mechanical rule the original passed. Then run adjudication and
  level-and-selection over the result.

**`DROP` and `FIX` from the first two lenses are advice**, and so is every suggested
string in them. The calling session decides what is written to `data/cards/`.

**An adjudication `REVERSED` is not advice.** It is the check on that deciding session,
so treating it as one more opinion to weigh restores the loop it exists to break.
Overturn one only for a reason that lives in the card rather than in the author, and
record every instance: a session overturning most of them is the failure mode this lens
was added to make visible.

**Report every overturned verdict to the owner, with the reason.** A kept `DROP`, a
`FIX` applied differently from the suggestion — each one is named in the summary of the
run. Without that, nobody can notice the review has become a rubber stamp, which is the
state it decays into silently.

**What the owner is not asked to do is re-judge the English.** An owner studying toward
a level they have not reached cannot rank their own vocabulary, and asking them to
confirm a batch they cannot evaluate produces a signature, not a check. The lenses carry
that judgement; the owner carries scope, purpose and whether to ship. State which
verdicts were overturned and why, so the decision is visible — not so the owner can
re-derive it.
