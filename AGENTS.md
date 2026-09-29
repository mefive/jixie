# Codex project instructions

Before making changes in this repository, read `CLAUDE.md` completely and follow it as the canonical project instruction source.

When working in a subdirectory, also read and follow any more specific `CLAUDE.md` referenced by the root instructions, such as `apps/web/CLAUDE.md` for frontend work.

When adding or renaming a deployable workspace/package, or changing cross-package build dependencies,
update `deploy/component-impact.json` and `scripts/deploy/plan-deployment.test.mjs` in the same change. Unknown
paths intentionally trigger a full deployment.

When implementing a user-requested task, prefer completing its full coherent scope in one change. Do
not invent phases or stop after an arbitrary "first phase" unless the user explicitly requests staged
delivery, safe completion is blocked, or the remaining work would materially expand the requested
scope or risk. Make reasonable in-scope assumptions and finish all directly implied parts before
asking what to do next.

## Code spacing preference

Use blank lines to express reading steps: separate steps, keep each step compact.

- Separate data preparation from the following action, validation, or loop with one blank line.
- Give independent steps their own paragraphs, even when a step is a single statement. For example:
  position checks, order execution, settlement, progress reporting, and strategy decisions.
- Keep tightly paired operations together, such as initialization and its start log, result
  collection and its result log, or a lifecycle guard and the corresponding state update.
- Separate the final return from the preceding processing. Keep a short guard and its immediate
  return together; do not add blank lines to one-line methods just to satisfy a pattern.
- Do not separate every declaration or every `if` mechanically. Related declarations and checks
  may remain grouped; the boundary is a distinct reading step, not the statement syntax.
- Put a paragraph's explanatory comment after the blank line and directly above its code.
  Use only one blank line, with no leading or trailing blank line inside a function.
- Preserve user-adjusted spacing. A spacing-only request does not authorize expression rewrites,
  inlining, method extraction, or changes to call order.
