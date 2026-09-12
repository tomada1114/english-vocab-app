# english-vocab-app

[![CI](https://github.com/tomada1114/english-vocab-app/actions/workflows/ci.yml/badge.svg)](https://github.com/tomada1114/english-vocab-app/actions/workflows/ci.yml)

A personal, local-only English vocabulary card app with FSRS scheduling.

## What this is

A Next.js application on the App Router: a locale-prefixed page tree, built from a
template whose one language-model call and its port have already come out — this app
runs no model at runtime. ESM-only TypeScript throughout.

`AGENTS.md` describes the architecture and the rules; this file is the tour.

## Quick start

```sh
pnpm install
pnpm dev
```

Then open <http://localhost:3000>, which redirects to `/en` — the app is English-only
for now. The page it renders is `src/app/[locale]/page.tsx`, and the text on it comes
from `messages/en.json`. The `/[locale]/` tree and the typed catalogs stay in place so a
locale can be added back by reverting that decision; see `starting-an-app`'s "The locale
decision".

## Daily use

Build and start the local app with:

```sh
pnpm build && pnpm start
```

Then open <http://127.0.0.1:3000/en>. Review history lives in
`.data/english-vocab.sqlite`; set `VOCAB_DB_PATH` to use a different SQLite file. New
cards come from the `generating-cards` skill; after generating them, run:

```sh
pnpm cards:lint
```

## Starting a new app from this template

Copy the tree, then work through
[`starting-an-app`](.agents/skills/starting-an-app/SKILL.md), which owns the procedure
and the order it runs in: rename first, then decide whether to keep the language-model
layer or remove it whole, then decide the locales, then run `pnpm check:source` once.

The rename is what the title, the description and the author above are waiting for —
they are this template's own identity strings, deliberately left as placeholders.
`tests/placeholders.test.ts` holds the complete list of where one still stands, and a
new app is finished renaming when that list is empty and the test is green.

## Development

This package is private: nothing here is packed, published, or consumed as a tarball.

```sh
corepack pnpm@11.18.0 install --frozen-lockfile
pnpm check:quick
```

The install puts the Git hooks in place on its own — lefthook's `postinstall` does it,
on every non-CI install — and `package.json`'s `prepare` script then runs
`scripts/verify-hooks.mjs`, which fails the install if the pre-commit hook did not
actually land. So there is no setup step for the hooks; `pnpm hooks:install` is the
repair when that check reports one is needed.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete workflow, and
[AGENTS.md](AGENTS.md) for the architecture, the command index, and the rules every
change is held to.

## License

[MIT](LICENSE) © tomada
