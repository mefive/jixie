# Contributing to jixie

Read [CLAUDE.md](CLAUDE.md) before changing this repository. It is the canonical
project instruction source; frontend work also follows [apps/web/CLAUDE.md](apps/web/CLAUDE.md).

## Commit messages

Write every commit subject and body in English. Use this format:

```text
type(scope): imperative description

Explain why the change is needed and any important behavior or compatibility
constraints. Include validation results when useful.
```

- Use one of `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`,
  `chore`, or `revert`.
- Always include a lowercase kebab-case scope. Prefer the affected business
  module (`research`, `factor`, `strategy`, `market`, `signals`, `agent`, `auth`),
  application (`api`, `web`, `docs`), or engineering area (`engine`, `sdk`,
  `sandbox`, `maintenance`, `deploy`, `i18n`, `architecture`, `repo`). Historical
  module scopes remain valid; scope names are not a closed allowlist.
- Start the description with a lowercase imperative verb such as `add`, `fix`,
  `preserve`, `remove`, or `document`. Preserve the spelling of technical names
  such as Python, API, ETF, and Research SDK.
- Keep the complete subject within 100 characters, preferably within 72. Do not
  end it with punctuation. Describe the actual change instead of just a milestone
  number or a vague statement such as "complete phase 3".
- Separate the optional body from the subject with a blank line. Put milestone
  references, motivation, limitations, and historical validation details here.
- Use `!` before the colon for a breaking change and explain migration requirements
  in a `BREAKING CHANGE: ...` footer.
- Preserve contributor names and attribution trailers exactly, including names
  in non-Latin scripts. Never translate an author's identity.
- Finalize fixup or squash placeholder messages before submitting commits.
  Reverts and merge commits must also use the standard subject format.

Examples:

```text
feat(research): expose point-in-time financial statements
fix(engine): reject trades blocked by daily price limits
refactor(api): clarify resource routes and ownership
docs(architecture): explain backend dependency boundaries
```

Use `feat` for new capabilities, `fix` for incorrect behavior, `refactor` for
structural changes without intended behavior changes, and `perf` for performance
improvements. Use `docs` and `test` for documentation and tests, `build` for build
systems or dependencies, `ci` for CI configuration, `chore` for other maintenance,
and `revert` for reversions.

`pnpm install` installs the existing Git hooks through `prepare`. The `commit-msg`
hook runs the dependency-free checker in `scripts/checks/check-commit-message.mjs`.
Run it explicitly with `pnpm check:commit-message <message-file>`; run its tests
with `pnpm test:commit-message`. The checker enforces structure, length, and
obvious untranslated Chinese prose. It cannot judge English grammar or whether
a summary accurately describes a diff; reviewers must check those properties.
Local hooks can be bypassed and are not a server-side enforcement mechanism.

## Review and verification

Keep each change coherent and finish its agreed scope. Follow the review workflow
agreed with the maintainer. When review-gated development is requested, settle the
scope and exact commit message before implementation, run static checks before
human review, and run behavioral verification only after review approval. Commit
after the required verification and applicable authorization; do not push on the
maintainer's behalf.
