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
