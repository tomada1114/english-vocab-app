---
name: generating-cards
description: >
  Covers writing a batch of English vocabulary card JSON under data/cards/: choosing
  purpose, topic, CEFR range and count, checking existing ids, applying the card-writing
  rules, running the card Lint, putting the batch through every review lens, and handing
  the result to the owner. Use when generating or editing a batch of cards, or when
  deciding whether a topic belongs on an existing card.
---

# Generating Cards

**Owns:** the procedure for generating a batch of vocabulary cards and applying the
card-writing rules. **Does not own:** the card schema and mechanical Lint
(`building-the-vocab-app`), independent verdicts (`reviewing-cards`), or test placement
(`placing-tests`).

**REQUIRED:** `building-the-vocab-app` for the card shape and application vocabulary.
**REQUIRED:** `reviewing-cards` for the independent review of every batch.

## Inputs

Before writing anything, record four inputs:

- the purpose id, such as `ielts`;
- one or more topic ids from `data/topics.json`;
- an inclusive CEFR range, such as `B2–C1`; and
- the number of cards to propose.

The purpose and topic values are the committed list ids, not display labels or new
spellings. The level is a card's authoring target; the schema and Lint remain the final
authority for what can be committed.

A fifth input is not a number and is the one most often skipped: **what the learner is
actually trying to do**. `ielts` is a filter id, not a purpose — "IELTS band 7.0,
roughly CEFR C1, Writing Task 2 and Speaking Part 3" is what tells you whether a word
earns its card, and it is what the level-and-selection lens has to be handed.

## Procedure

1. List every existing id under `data/cards/`, including retired files. Exclude an id
   already present; retirement does not make a key available again.
2. For each new key, write one JSON file named `<cardId>.json`. Keep the exact card
   shape and derive the id from the headword and part of speech.
3. When an existing card fits the requested topic, propose adding the topic tag to that
   card instead of creating a duplicate.
4. Run `pnpm fix`, then run `pnpm cards:lint` until it reports no ERROR. Treat warnings
   as review prompts, not release blockers; fix the card text or tags and do not weaken
   a rule to make a batch pass.
5. Run the **blind-answer** and **perspective** lenses in `reviewing-cards` as
   independent runs. Apply the merged verdicts and run `pnpm cards:lint` again.
6. Run the **adjudication** and **level-and-selection** lenses over the result. Apply
   every `REVERSED` ruling and every level-and-selection `DROP`; a word below the
   batch's floor is removed, never relabelled up (`C10`). Run `pnpm cards:lint` again.
7. Count the batch's parts of speech and check the counts the purpose depends on
   (`C11`). File the lens's `missing` words as the next batch rather than folding them
   into this one — they would ship unreviewed.
8. Hand the final diff to the owner on a branch. Never commit generated cards directly
   to `main`.

Steps 5 and 6 are two rounds, not one: the last two lenses read the cards that are going
to ship, including whatever step 5 changed about them.

## Writing one card

Use the shape in the `building-the-vocab-app` card reference. The front is an English
definition plus one sentence with exactly one `___`; the back is the headword plus two
examples. Put the judgment rules in [card-rules.md](references/card-rules.md), not in a
new field or a private convention.

The definition, cloze and examples must describe the same sense. The cloze's collocation
should do the main work of separating the answer from plausible rivals. Examples should
add usable contexts rather than explain the writing process. Do not add a translation
field, pronunciation, or metadata that the schema does not own.

**Read every definition back as someone who does not know the answer** (`C9`). The leak
the Lint cannot see is a plain synonym of the headword sitting in the definition, and it
is invisible to the author for the same reason it is fatal to the learner.

## Review handoff

Give each lens only the fields it requires and label the batch `c1` through `cN`; never
disclose a card id or headword to the blind-answer lens. Keep the mapping from those
labels to real ids in the calling session. A clean Lint is necessary but is not a
substitute for any lens.

The owner decides whether to apply a `FIX` or `DROP` from the first two lenses. An
adjudication `REVERSED` is not theirs to weigh: it is the check on this session's own
overrides, and overturning one needs a reason in the card, recorded. After those
decisions, record the final card diff, every lens result, any overturned verdict, the
part-of-speech count, and the final Lint result.

The generation run does not change the database, invoke a runtime model, or close an
issue.
