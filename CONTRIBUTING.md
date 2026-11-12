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
Run it explicitly with `pnpm check:commit-message <message-file>`; this runs the
checker self-tests first and validates the file only if they pass. The Git hook
continues to validate the message directly. The checker enforces structure, length, and
obvious untranslated Chinese prose. It cannot judge English grammar or whether
a summary accurately describes a diff; reviewers must check those properties.
Local hooks can be bypassed and are not a server-side enforcement mechanism.

## Review and verification

Review-gated development is mandatory by default in every session, including small
and one-shot changes to code, tests, configuration, scripts and documentation. Read
the available `review-gated-development` skill in full before starting a repository
change; the maintainer does not need to invoke it again. Follow the canonical
workflow in [CLAUDE.md](CLAUDE.md). Read-only analysis does not require development
approval, and explicit instructions from the maintainer may adjust the workflow.

Keep each change coherent and finish its agreed scope. Before implementation,
present the scope, exact commit message, deliverables, approach, affected surfaces
and validation plan, then wait for scope approval. For product-code changes, finish
static checks and stop for human code review before running tests, builds or other
behavioral verification. Test-only corrections within the approved scope follow
the skill's exception; they cannot authorize tests while product changes await
review. Product changes made during verification require renewed review.

Product-code review approval authorizes the planned verification and an automatic
commit with the agreed message once all required checks pass. Do not request a
separate commit confirmation. Preserve prior approvals when continuing across
sessions, stage only in-scope files and leave unrelated work intact. Do not commit
with failed or incomplete required checks, or push on the maintainer's behalf.
