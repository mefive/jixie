# Codex project instructions

Before making changes in this repository, read `CLAUDE.md` completely and follow it as the canonical project instruction source.

When working in a subdirectory, also read and follow any more specific `CLAUDE.md` referenced by the root instructions, such as `apps/web/CLAUDE.md` for frontend work.

When adding or renaming a deployable workspace/package, or changing cross-package build dependencies,
update `deploy/component-impact.json` and `scripts/plan-deployment.test.mjs` in the same change. Unknown
paths intentionally trigger a full deployment.

When implementing a user-requested task, prefer completing its full coherent scope in one change. Do
not invent phases or stop after an arbitrary "first phase" unless the user explicitly requests staged
delivery, safe completion is blocked, or the remaining work would materially expand the requested
scope or risk. Make reasonable in-scope assumptions and finish all directly implied parts before
asking what to do next.
