---
name: starting-an-app
description: >
  Covers turning this template into a new application: the copy-and-rename procedure
  driven by tests/placeholders.test.ts, what a new project keeps untouched, and whether
  to keep both locales or drop one. Use when starting an app from this repository,
  replacing the package name, the app's display name or the repository slug in a badge
  or advisory link, or dropping a locale from src/i18n/locales.ts and messages/.
---

# Starting an App

**Owns:** turning this repository into a new application — the rename, what the new app
keeps, and the locale decision. **Does not own:** how a skill is authored or mirrored
(`authoring-skills`); the README's own prose (`updating-docs`); what a gate file may
contain (`changing-gates`); working inside the App Router tree (`building-app-routes`).

There is deliberately no bootstrap script. The one this repository used to ship was
profile-driven machinery that rewrote the tree and then deleted itself, so the only
record of what it did was a file that no longer existed. What replaced it is this
procedure plus a test holding the list a script would have hard-coded. Do not
reintroduce a script, a profile, or a self-deleting block.

## The order

Rename first, so nothing downstream is written against the template's identity. Decide
the locales last, then run `pnpm check:source` once. Each step below names the narrower
check to run while you are inside it.

## The rename

`tests/placeholders.test.ts` owns the inventory: `PLACEHOLDERS` is every string that
names _this template_ rather than a project built from it, and `EXPECTED_INVENTORY` is
the complete list of `<file>: <placeholder>` sites where one still stands. That list is
the checklist, and it is machine-checked, so this skill does not restate its rows —
holding them in two places is how one of them goes stale.

Work through it:

```bash
pnpm exec vitest run tests/placeholders.test.ts
```

The inventory is pinned with an exact comparison, so a failure prints the sites that
remain against the sites the list expects. Replace one site, delete its row from
`EXPECTED_INVENTORY`, run again. You are finished when the list is empty and the suite
is green: an empty inventory means no identity string of this template survived anywhere
in the tree, not merely in the files someone remembered to open.

The suite's second block, over the CI badge and the security-advisory link, checks those
two URLs by their _shape_ — the path segments and the workflow filename — and leaves the
owner and the repository unconstrained. It passes on your slug exactly as it did on the
template's, so it needs no edit during the rename; what pins the slug itself is the
inventory row for each of those files.

What goes into each site:

- **The package identity** — `package.json`'s `name` and `description`. `private: true`
  stays: nothing here is published, so the name only has to be one you recognise, not
  one that is free on the registry.
- **The repository slug**, wherever a URL names a GitHub repository — the README's CI
  badge and the security-advisory contact link in `.github/ISSUE_TEMPLATE/`. A slug left
  behind renders a broken badge and sends a vulnerability reporter to a stranger's
  advisory form.
- **The copyright holder** in `LICENSE`, and the same name wherever the README repeats
  it. Every fork inherits `LICENSE` verbatim, which is why the template ships a blank.
- **The app's display name** — the `title` in `src/app/[locale]/layout.tsx`'s
  `metadata`, which is the browser tab, and the `HomePage.title` key in
  `messages/en.json` and `messages/ja.json`, which is the page heading. Only the catalog
  half is per-locale — each catalog gets the name written in its own language; the
  layout's `title`, like `description` below, is one hard-coded string.
- **The one-line `description`** in that same `metadata` block, which renders into
  `<meta name="description">` and so into search results and link previews. It is not
  per-locale — the layout hard-codes one string for every locale — so there is one site,
  not one per catalog.

Those are the only reader-visible strings the inventory covers. The home page's body
text — each catalog's `HomePage.intro` and `HomePage.localeCount`, which still describe
the page as a template — is deliberately left out: it is demo copy for a demo page you
are expected to rewrite or delete, so pinning it would pin strings that may not survive
your first day, and one of them is quoted in `localizing-ui` as a worked example that
has nothing to do with your identity. Review that copy by hand once the page is yours.
`tests/home-page.test.tsx` asserts the English `intro` as a literal, so rewriting it
turns that test red; update the assertion in the same edit.

Emptying `EXPECTED_INVENTORY` is the intended edit and is not weakening a gate. Widening
`SKIPPED_DIRECTORIES` or `SKIPPED_FILES`, or dropping an entry from `PLACEHOLDERS`, to
make a row disappear is — the row would stop being reported without the string being
gone. AGENTS.md's "never weaken a gate to make a run pass" covers that.

## What the new app keeps

Everything below is about the repository rather than the application, so it survives the
rename unchanged and is most of what starting from this template buys:

- **The gate set** — `package.json`'s `check:quick` / `check:source` and the scripts
  they call, `lefthook.yml`, and `.github/workflows/`. A red run early in a new project
  is an argument for fixing the code, never for deleting the check that found it.
- **The guard engine** — `scripts/lib/guard/` and `scripts/check-staged.mjs`, the one
  mechanical layer this repository ships and the only thing standing between a secret
  and the commit history. It is language-agnostic; keep it whatever the app becomes.
- **The skills** under `.agents/skills/` and their generated mirror. Drop one only when
  the subject it owns actually leaves the repository, rather than leaving the call to
  memory. **REQUIRED:** `authoring-skills` for the loop that keeps the two trees
  identical, and for the AGENTS.md Skills table row that
  `tests/skills-frontmatter.test.ts` requires in both directions.
- **The label taxonomy** — `.github/labels.yml` and `scripts/sync-labels.mjs` behind
  `pnpm repo:labels`. Run `pnpm repo:labels` against the new repository early: an issue
  form applying a label that does not exist yet fails silently rather than reporting
  one. **BACKGROUND:** `triaging-issues` for what the labels mean.
- **`.env.example`**, even when the app reads nothing yet. `src/server/env.ts` is the
  only module that touches `process.env`, and `tests/server-env.test.ts` asserts the two
  stay in step; the example file is half of that check.

## The locale decision

The template ships `en` and `ja`. Keeping both costs nothing and is the default; the
other choice is dropping one, and a third locale is added by reading the same list
forward. Dropping `ja` touches:

- `src/i18n/locales.ts` — `LOCALES`, which is the closed union everything else derives
  from.
- `messages/ja.json`, deleted, and `src/i18n/messages.ts`, which statically imports it
  and keys `MESSAGES` by locale.
- `messages/en.json` — the switcher entry naming the dropped language.
- `src/server/handlers/ask.ts` — `OUTPUT_LANGUAGE_BY_LOCALE`, the one place a UI locale
  is mapped to the language the model writes in. Only if the AI layer stayed.
- `tests/messages.test.ts` — its switcher key in `MESSAGE_KEYS`, plus every other place
  it names the locale literally — and `tests/proxy.test.ts`, `tests/home-page.test.tsx`,
  and `tests/server-handler.test.ts`, each of which names the locale literally too.
- `README.md`'s quick start, and AGENTS.md's Conventions exception, which names
  `messages/ja.json` as the one committed file that is not in English.

`src/proxy.ts` does **not** change: its matcher excludes API routes, framework asset
trees and paths with an extension, and names no locale at all. `tests/proxy.test.ts`
does change, because its cases spell one out.

Two of these fail at compile time rather than at runtime, by design:
`OUTPUT_LANGUAGE_BY_LOCALE` and `MESSAGE_KEYS` are written with `satisfies`, so a locale
removed from `LOCALES` without its entries removed fails `pnpm typecheck` instead of
rendering a key as its own name in production — `MESSAGE_KEYS` lives in
`tests/messages.test.ts` rather than in `src/`, but `tsconfig.json`'s `include` covers
`tests`, so `pnpm typecheck` type-checks it there too. Check with:

```bash
pnpm exec vitest run tests/messages.test.ts tests/proxy.test.ts
```

One locale still means a prefixed URL: `localePrefix` defaults to `"always"` in
`src/i18n/routing.ts`, so `/` keeps redirecting to `/en`. Changing that is a routing
decision, not part of the rename, and it is what `tests/proxy.test.ts` asserts either
way.
