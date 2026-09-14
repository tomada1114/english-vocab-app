# The adjudication lens

One question: **were the verdicts the calling session overturned actually wrong?**

The other two lenses review the cards. This one reviews the _review_ — specifically the
step where the session that wrote the batch decided which findings to accept. That step
is self-review wearing a different hat, and it is the one the first two lenses cannot
reach.

## Why this lens exists

`reviewing-cards` sends the cards to an independent run precisely because an author
cannot see the faults in their own work. Then the findings come back, and the author
decides which ones count. Everything the separate run bought is spent again at that
moment: a session that wrote a front and believes it is unambiguous will read "a second
word also fits" and reach for a reason it does not apply here.

Measured on the first batch that ran this pipeline: of 22 findings the calling session
overturned, an independent adjudication upheld 9 and **reversed 11**, with 2 too close
to call. Five of the reversals were the plain C9 leak — the definition contained the
rival word — which the calling session had already found and fixed on four _other_ cards
in the same batch, and still could not see on these.

Half of a session's overrides being wrong is the expected rate, not a bad run.

## What the run is handed

For **every card whose verdict the calling session overturned**, in the same `c1` … `cN`
labels the other lenses used:

- the rival word the earlier lens named;
- the answer word;
- the `definition` and the `cloze` as they now stand, after any other fix was applied.

**Not the reason for the override**, not who made it, not the rule it was made under,
and not how many were overturned. The run is told a human overruled the findings and
that it is checking whether that was right — nothing about why, because a stated reason
is the thing most likely to be adopted rather than tested.

The rule the overrides were made under is the one exception, and only when the owner has
settled one (see [Where the line sits](blind-answer.md#where-the-line-sits)): the run
cannot judge whether a rule was applied correctly without being told the rule. Pass the
rule as text; never pass the verdict it produced.

## The prompt

Paste this whole section together with the cards.

```text
You are an independent adjudicator for English vocabulary flashcards aimed at a
learner preparing for a language exam. Each card shows an English definition
plus a sentence with the answer blanked as ___ . Your judgement is final and
decides what ships; nobody will re-check it.

An earlier automated check flagged each of these cards, saying a second word
also fits the front. A human then overruled every one of those flags. You are
checking whether that overruling was correct, card by card. The person who
overruled them is not available and their reasoning is not given to you. Assume
nothing about whether they were right: the point of this pass is that they
graded their own work, and roughly half of such calls are wrong.

For each card, decide two things independently.

1. SENSE OR REGISTER. Do the answer word and the named rival differ in sense, or
   only in register and formality? "Only register" means a competent writer could
   swap them in most contexts with no change in meaning. "Different sense" means
   a real distinction in meaning, scope, specificity, typical subject or object,
   or connotation. Be strict: most pairs that feel interchangeable are not. Name
   the distinction when one exists.
2. FIRST ANSWER. Reading only the definition and the cloze, which word would you
   actually produce first? If you would produce the rival, the card fails in
   practice whatever any rule says, because the learner will be marked wrong for
   a correct recall.

Then rule:
  UPHELD   - same sense, and the answer word is what you would produce first.
  REVERSED - the words differ in sense, OR you would produce the rival first.
  MARGINAL - genuinely too close to call.

Return one JSON object, and no prose around it:

- "lens": the string adjudication
- "rulings": one entry per card, in the order given, each with "id", "ruling",
  "distinction" (the difference in sense, or the string NONE), and
  "first_answer" (the word you would produce first)
- "findings": an entry for each REVERSED or MARGINAL card only, with "id",
  "verdict" (the string FIX), "confidence", "reason", and the three keys
  "suggest_definition", "suggest_cloze" and "suggest_examples" (null where you
  propose nothing). A replacement must leave only the answer word, and must not
  contain the answer word, an inflection of it, or the rival.

Cards:

c1
rival word named by the earlier check: <rival>
answer word: <headword>
definition: <definition>
cloze: <cloze>

Repeat that block for every card, keeping each card's own label.
```

## Reading what comes back

`rulings` is the evidence and `findings` is the work. Read both: a run that upholds
everything has probably been told too much, and a run that reverses everything has
probably not been given the rule.

| The ruling | What the calling session does                                         |
| ---------- | --------------------------------------------------------------------- |
| `UPHELD`   | Nothing. The override stands and the card ships as it is              |
| `REVERSED` | Apply the fix. The override was wrong                                 |
| `MARGINAL` | Apply the fix unless there is a reason in the card, not in the author |

**A `REVERSED` ruling is not advice.** Every other verdict in this skill is, because
every other verdict is one run's opinion against the calling session's judgment. This
one _is_ the check on that judgment, so treating it as advice restores exactly the loop
it exists to break. Overturn one only with a reason that would survive being read back
by someone who did not write the card — and record it, so a session that overturns most
of them is visible rather than merely confident.

`MARGINAL` is the useful middle: the run saw the difficulty and could not resolve it.
Defaulting those to the fix costs a slightly narrower card; defaulting them to the
override costs a card the learner answers correctly and is marked wrong on.

## When this lens runs

After the merged verdicts from the other two lenses have been applied, and **before the
batch is handed over** — the cards it reads are the fixed ones, because a front that
changed for one reason may no longer carry the ambiguity that was overruled for another.

A batch where the calling session overturned nothing skips this lens. That is the only
case that skips it, and it is worth a second look on its own: a session that accepted
every finding without judgement has not been reviewing either.
