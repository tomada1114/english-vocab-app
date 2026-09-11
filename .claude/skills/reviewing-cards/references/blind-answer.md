# The blind-answer lens

One question: **given only the front, is there exactly one word that fits?** A card
whose front admits a second plausible answer teaches the owner to guess, and marks a
correct recall wrong.

## What the run is handed

Only `definition` and `cloze`, for each card, labelled `c1` … `cN`.

Not the headword. Not the examples, which use it. Not the card id, which is derived from
it. Not the level or the topics, which narrow the guess in a way the owner will not have
when the card comes up.

This is the whole mechanism of the lens: a reviewer who has seen the answer cannot stop
seeing it, and will report every front as unambiguous because to them it is. The run has
to be able to get the card wrong.

Because the run does not know the headword, it does not decide the card's fate either.
It reports which words fit; the calling session compares that list against the real
headword.

## The prompt

Paste this whole section together with the cards. Nothing about where the cards came
from, who wrote them, or what was asked for.

```text
You are reviewing the fronts of English vocabulary flashcards for a learner
preparing for IELTS. Each front is an English definition plus one sentence with
the answer word blanked out as ___ . Exactly one English word should fit both
halves at once.

For every card, list every English word that fits the definition AND reads
naturally in the blank. Work from the definition and the sentence alone.

- The blank is not a length hint: it is always three underscores, whatever the
  answer is.
- Count the forms of one lemma as one word: "mitigate" and "mitigates" are one
  entry, not two.
- Include a word only if it fits both halves. A word matching the definition but
  taking a different preposition or object in the sentence does not fit.
- Rank the list with the word you would answer first.
- Do not guess at what the card intends. If nothing fits, return an empty list.

Return one JSON object, and no prose around it:

- "lens": the string blind-answer
- "answers": one entry per card, in the order given, each an object with "id"
  (the card label) and "words" (your list, as an array of strings)
- "findings": an entry ONLY for each card whose list does not hold exactly one
  word, with "id", "verdict" (the string FIX, or DROP when the words are true
  synonyms that no wording could separate), "confidence" (high, medium or low),
  "reason" (one sentence), and the three keys "suggest_definition",
  "suggest_cloze" and "suggest_examples" (null where you propose nothing).
  Suggest a narrowed definition or cloze that leaves only one of the words you
  listed. Never suggest an example: you have not seen any.

Cards:

c1
definition: <definition>
cloze: <cloze>

Repeat that block for every card, labelled c1, c2, c3 in the order given.
```

## Reading what comes back

Compare each card's `words` against its real headword:

| The list                                 | The verdict                                  |
| ---------------------------------------- | -------------------------------------------- |
| Exactly the headword                     | Pass                                         |
| The headword plus another plausible word | `FIX` — the front needs narrowing            |
| One word, and it is not the headword     | `FIX` — the front describes a different word |
| Empty                                    | `FIX` — the front is unanswerable as written |
| Only true synonyms of the headword       | `DROP` if no wording separates them          |

A run that files its own `FIX` for an ambiguous card has done the caller's arithmetic
already; the last two rows are the ones only the caller can see, because they turn on
the headword.

**Narrow in the front, never elsewhere.** A card has no hint field, so the only places
to add the distinguishing detail are the definition and the cloze:

- a collocation the headword takes and the rival does not, put into the cloze;
- a register or usage note folded into the definition ("the way a report would put it");
- a more specific scene in the cloze, so the rival reads as odd rather than as wrong.

Lengthening the definition until it is unique is not one of them: the Lint caps the
front at 40 words, and a front that long stops being readable at recall speed anyway.

## Where the line sits

What counts as "another plausible answer" is deliberately not settled — the
`building-the-vocab-app` skill lists it as open, to be tuned after the first batches.
Until then:

- a word an upper-intermediate candidate would actually produce counts; a rare or
  technical one does not;
- an inflection of the headword is never a rival;
- a word that fits the definition but not the cloze's collocation is not a rival, and a
  run that lists one should be read as evidence the cloze is doing its job.

Record a decision on a borderline card in the pull request that lands it, so the line
moves once and visibly rather than per batch.
