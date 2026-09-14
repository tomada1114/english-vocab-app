# Card Writing Rules

These eight rules adapt the reference phrase-design rules to this app's card shape. They
are authoring guidance for a learner preparing for IELTS. The schema and the mechanical
Lint remain authoritative for fields, allowed values and hard limits.

## C1. Keep the card shape

Write one strict card object with an id derived from its headword and part of speech.
Use the fields the card schema owns: headword, part of speech, level, purposes, topics,
definition, cloze and two examples. Do not add a translation field, pronunciation, or
generation metadata. The front is the definition and cloze; the back is the headword and
examples.

## C2. Make the front answerable

The definition and cloze together should lead to one plausible English answer. Never
write the answer or an inflection of it into the front. The cloze's collocation is the
main way to narrow a front: choose a subject, object, preposition or scene that the
headword naturally takes and a rival does not. Do not rely on a hidden hint field.

## C3. Keep wording readable

Use short, plain English in the definition: A1–A2 wording is the target and B1 is the
upper guidance limit. This is authoring guidance, not a second Lint rule. Keep the
definition useful at recall speed rather than lengthening it with a list of synonyms;
the Lint owns the hard front and cloze limits.

## C4. Use the headword in examples

Each of the two examples uses the actual headword in the sense defined on the front.
Make each a natural sentence a learner could plausibly encounter in the target topic or
exam context. Do not substitute a synonym, an unrelated inflection, or a sentence that
exists only to display the word.

## C5. Ground the word in the target

Choose a word that a candidate at the requested level actually meets in the requested
topic. The purpose and topic tags should describe where the learner can use the card,
not merely where the generator happened to find it. A familiar word with a genuine topic
use is better than a rare word forced into a topic sentence.

## C6. Keep one key per sense

The key is `(headword, pos)`, and one card earns that key. Check active and retired
cards before writing. If an existing card already carries the sense, do not duplicate
it; propose the missing topic tag instead. A second part of speech needs a distinct
sense and definitions that make the distinction visible.

## C7. Keep the back honest

The back must show the headword and the two examples that use it. Do not hide a second
answer, explain the card's metadata, or use reviewer and generator language in the
learner-facing text. Every sentence should stand as ordinary English when read without
the card-writing instructions.

## C8. Give every example a different context

The cloze and the two examples must teach separate uses. Change the scene, the
collocation or the grammatical setting so that the second sentence adds information;
changing only a noun or word order is a disguised echo. The examples must also differ
from each other in scene and structure. The mechanical Lint catches only its explicit
checks, so make this distinction deliberately and let `reviewing-cards` challenge it.

### Worked example

The example below is also committed as `tests/fixtures/cards/resilience--noun.json`. The
card schema, file name and card Lint must agree with this block.

```json
{
  "id": "resilience--noun",
  "headword": "resilience",
  "pos": "noun",
  "level": "B2",
  "purposes": ["ielts"],
  "topics": ["environment"],
  "definition": "the ability to recover after a serious problem",
  "cloze": "Coastal towns need ___ after repeated storms.",
  "examples": [
    "The team showed resilience under pressure.",
    "Her resilience impressed everyone during the exam."
  ]
}
```

## C9. Keep every rival out of the front

C2 asks the front to lead to one answer; the Lint enforces only the literal case, that
the headword and its inflections are absent. The leak that survives both is a **plain
synonym of the answer sitting in the definition**: "prevalent" defined as
`common in a particular place`, "symptom" as `a sign in the body`, "toxic" as
`containing poison`, "remedy" as `something that cures`, "deteriorate" as
`to become worse over time`. Each hands the learner a word that answers the front as
well as the headword does, and each was written by an author who could already see the
answer and so could not see the giveaway.

Before a definition is kept, read it as someone who does not know the answer and name
the word it most points to. When that word is not the headword, the definition is
describing the rival. Rewrite it around the situation the word is used in — what is
being depleted, who is susceptible to what — rather than around a shorter word for the
same idea.

This rule is not about register. A definition may legitimately use a formal or an
everyday cousin of the headword when no reader would submit it as the answer; it may
never use the word a reader would actually write in the blank.

## C10. Declare the level honestly, or drop the word

`level` is the author's claim about where a learner meets the word, and a batch is
filtered by it: a card declared inside the requested range but sitting a band below it
is served forever to someone who already knows it, and spends a review slot that a word
they do not know should have had.

Judge the level against the word a learner actually produces, not against how the word
looks. A transparent compound of two easy words (`wildlife`), a regular derivation of a
known verb (`distraction`), and a word carried into the learner's first language as a
loanword (`hygiene`, `seminar`) are all below B2 however academic the topic is.

A word that turns out to sit below the batch's floor is **removed, not relabelled up**.
Relabelling is what makes the level field stop meaning anything, and it is also how a
batch passes an off-level check while carrying exactly the cards that check exists to
keep out.

## C11. Balance the batch, not only the card

Every rule above judges one card. A batch also has a shape, and a batch of individually
correct cards can still fail its purpose: 93 cards weighted 60 nouns to 11 verbs give a
learner the things an argument is about and no way to say what should be done about
them, so every sentence falls back on `do`, `make`, `help`, `stop` — which is what caps
an exam script below the target band.

Before the batch is handed over, count its parts of speech and ask what the learner will
be able to _produce_ with it, not what they will recognise. For an exam purpose, the
verbs and the evaluative adjectives are the load-bearing half; a topic noun is the easy
half to write and the easy half to over-supply.

Report the count with the batch. A skew the author names is a decision; a skew nobody
counted is an accident that reaches the deck.
