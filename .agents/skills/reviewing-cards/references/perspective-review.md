# The perspective review

Five criteria over the whole card and the deck it is joining. Where the blind-answer
lens asks one question with the answer hidden, this run sees everything — including the
headword — and looks for the defects that are only visible once you do.

## What the run is handed

Each card's `definition`, `cloze`, `headword`, `examples` and `level`, labelled `c1` …
`cN` rather than by card id, plus the existing card list: every card already under
`data/cards/`, retired ones included, as headword plus definition.

Nothing about the batch's history. A card that was already rewritten once is reviewed as
if it arrived that way.

## The prompt

Paste the criteria below in full — every heading with the paragraph under it. A run told
only that there is a "disguised echo criterion" does not know what it is looking for,
and will report nothing.

```text
You are reviewing English vocabulary flashcards for a learner preparing for
IELTS. Each card has an English definition, a sentence with the answer blanked
as ___ (the cloze), the answer word itself (the headword), two example sentences
and a CEFR level.

Your job is to find violations of the criteria below. Do not confirm that cards
are fine, and do not comment on a card that breaks none of them.

Return one JSON object, and no prose around it:

- "lens": the string perspective-review
- "findings": one entry per failing card, with "id" (the card label), "verdict"
  (FIX when a rewrite would fix it, DROP when the card should not exist),
  "confidence" (high, medium or low) and "reason" (one sentence naming the
  criterion it breaks). A FIX also carries "suggest_definition",
  "suggest_cloze" and "suggest_examples" — a replacement string, or null where
  you propose no change; "suggest_examples" is a two-entry array with null in
  the slot that stays. A DROP carries none of the three.

One card may break several criteria. Report it once, with the most serious.
```

## The criteria

### Answer leak by paraphrase

The front must not give the answer away to a reader who has not recalled it. The Lint
already rejects the headword and its inflections appearing literally in the definition
or the cloze; what is left to this criterion is the leak by other words. A definition
that is a string of synonyms for the headword ("to lessen, to reduce, to ease") is one.
So is a cloze whose surrounding words name the answer in another form — a nearby antonym
plus a negation, a fixed phrase the headword is half of, a subject that only one verb
ever takes. The test is whether a reader who knows the paraphrase arrives at the word
without recalling it. Verdict: `FIX`, with a definition that describes the situation the
word is used in rather than restating the word. `DROP` when nothing is left to describe
— when the definition can only be the word itself.

### Example quality

Each of the two examples must be one natural sentence, using the headword in a scene
this learner could plausibly meet, in the sense the definition gives. The Lint has
already blocked an example that uses none of the headword's content words, and one over
its length cap; this criterion is about the sentences that pass those and still fail a
reader. Fire on an unnatural collocation (the headword is present but nobody pairs it
with that object or preposition), on dictionary stiffness (a sentence assembled to
demonstrate the word rather than to say something), on a scene from nowhere in this
learner's life, and on a sentence using a different sense of the headword from the one
the definition names. Verdict: `FIX`, with the rewritten sentence in the slot it
replaces.

### Disguised echo

An example must teach a second context, not repeat the cloze. The Lint catches only the
blunt case — the cloze with its blank filled in, and shared fragments of eight
characters or more. This criterion catches the rewording: the same scene and the same
collocation with the nouns swapped, the verb inflected, or the clause order reversed, so
the skeleton is still the cloze. Ask what the example adds that the cloze did not; if
the answer is a synonym of a noun, it is an echo. Verdict: `FIX`, with an example from a
different scene — a different register or a different grammatical role for the headword
is what makes it a second context.

### Overlapping examples

The two examples must differ from each other in scene and in structure, not only in
wording. The Lint compares them only for identical text. Fire when both are built on the
same pattern with the same kind of object ("we should ___ the cost" and "they should ___
the delay"), when both put the headword in the same position in the same clause type, or
when both come from the same setting so the word looks usable in one place only. Two
examples that overlap cost a card half its content. Verdict: `FIX`, replacing exactly
one of them — say which slot, and leave the other `null`.

### Duplicate synonym

The card must earn its place against the cards that already exist. Fire when the
headword is a synonym of an existing card's headword, at the same level and in the same
sense, and neither definition distinguishes them; and when the card repeats an existing
headword in another part of speech or another form without a distinct sense to justify
the second card. A deliberate pair — a formal word against its everyday counterpart —
passes only if each definition says which one it wants, in words the owner will see on
the front. An existing card that merely shares a topic is not a duplicate: the answer
there is to add the topic tag to the existing card, which is the generating run's job,
not a finding here. Verdict: `DROP` when the existing card already covers the sense;
`FIX` when a note or a collocation in one definition can separate the two.

## Reading what comes back

`DROP` is advice. A duplicate-synonym `DROP` in particular is the one most often worth
overturning — the run sees the existing list as text and cannot know the owner met the
two words in different places — and an overturned verdict is reported to the owner with
the reason, like any other.

A `FIX` whose suggestion is weaker than the original is normal: take the finding and
write the replacement yourself. That departure is reported too.
