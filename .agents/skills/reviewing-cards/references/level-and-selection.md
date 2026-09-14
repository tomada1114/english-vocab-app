# The level-and-selection lens

One question: **is this batch worth the learner's review time?**

The other lenses ask whether each card is well made. A deck can be made entirely of
well-made cards and still be the wrong deck: words the learner already knows, words they
will never need, levels that are wrong, and a shape that trains recognition when the
purpose needs production.

## Why this lens exists

Nothing else in the pipeline looks at word choice. The Lint checks shape. The
blind-answer lens checks that a front has one answer, not whether the answer was worth
asking for. The perspective lens checks the card against the deck, not against the
purpose. `C5` and `C10`-`C11` in the card rules ask the author to get this right, and
the author is the last person able to audit it, because the reason a word was chosen is
the reason it looks right.

It also carries the judgement the owner is least able to supply. An owner studying for
an exam in a language they do not yet control cannot rank their own vocabulary usefully;
that is the position the deck exists to fix. Where the other lenses advise a decision
the owner could make, this one answers a question the owner would have to guess at.

## What the run is handed

The whole batch, one line per card: `headword | pos | level | topics | definition`. Plus
the purpose the batch was written for, stated as what the learner is actually trying to
do — not the purpose id. `ielts` means nothing to a fresh run; "IELTS band 7.0, roughly
CEFR C1, Writing Task 2 and Speaking Part 3" gives it the standard to judge against.

Not the clozes and not the examples: those are the other lenses' subject, and including
them turns this run into a slower duplicate of the perspective review.

State plainly that the owner will not check the answer. A run that believes a human will
filter its output hedges; a run that knows its list is final commits to one.

## The prompt

Paste this whole section together with the batch.

```text
You are auditing the word list of a vocabulary deck. The learner is <learner>,
and this is their entire deck for the topics <topics>. They have delegated this
judgement to you: they will not check your conclusions, and nobody else will
either. What you approve is what they study.

Each line is: headword | part of speech | declared CEFR level | topics |
definition.

Report only problems. Do not confirm that entries are fine. Return an empty
list for a category when nothing is wrong with it.

Judge five things.

1. WRONG LEVEL. The declared level is wrong by at least one band. Say what it
   should be. Only report a level you are confident about; a word on a band
   boundary is not an error.
2. TOO EASY. The word sits comfortably below the target range. Such a card
   wastes review time forever: the learner knows it, and spaced repetition keeps
   serving it.
3. LOW VALUE. The level is right but the word rarely earns marks for this
   purpose - too narrow, too technical, too domain-locked, or simply not a word
   that is rewarded. Say why.
4. BAD DEFINITION. The definition is inaccurate, misleading about how the word
   is really used, restricts it to one of several senses, teaches the wrong
   grammar, or is too hard to read at recall speed. Quote the problem.
5. MISSING. Words this learner genuinely needs for these topics that are absent.
   Weigh the deck's part-of-speech balance: report it in the prompt and let the
   gap drive the suggestions. Cap at 15, most valuable first.

Return one JSON object, and no prose around it:

- "lens": the string level-and-selection
- "findings": one entry per problem card, with "id" (the card label), "verdict"
  (FIX for a wrong level or a bad definition, DROP for too easy or low value),
  "confidence" and "reason". A FIX also carries "suggest_definition",
  "suggest_cloze" and "suggest_examples", null where it proposes nothing; a DROP
  carries none of the three.
- "missing": one entry per absent word, with "headword", "pos" and "reason"
- "verdict": one paragraph - is this deck fit for its purpose as it stands, and
  what is the single most important thing to change about it

A suggested definition must be at most 14 words and must not contain the
headword or an inflection of it.
```

A level correction arrives as a `FIX` with no `suggest_*` content, because `level` is
not one of the three fields a suggestion can carry. Read it out of the `reason`.

## Reading what comes back

**`DROP` here is stronger than `DROP` from the perspective lens.** That one says a card
duplicates another; the calling session often knows better, because it knows the two
words were met in different places. This one says the word does not earn its slot for
the stated purpose, which is the judgement the run was given and the owner was not.

**A `too easy` finding is usually a deletion, not a relabel.** Correcting the level
honestly is the first move, and then the word is outside the batch's declared range and
has to go — see `C10`. A batch that relabels instead keeps exactly the cards the range
existed to exclude, and passes its own off-level check while doing it.

**`missing` is not a task for this batch.** It is the input to the next one. Folding
fifteen suggested words into the batch under review means shipping fifteen cards that no
lens has seen. File them.

**`verdict` is the line to read first and the line to quote.** It is the only place any
lens judges the deck as a whole, and it is what tells the owner whether the batch did
what they asked for — which the passing Lint, the green gate and the satisfied counts
all cannot.

## When this lens runs

**Once per batch, on the final word list**, alongside the adjudication lens and after
the other two have been applied. It reads levels and definitions, so it must see the
ones that are going to ship.

It runs on every batch, including a small one. A batch of five cards still has five
words that either earn their slot or do not, and the smaller the batch the cheaper this
lens is to run.
