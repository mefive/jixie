# GPT-6 sol implementation prompt for unified data synchronization

Copy the following prompt into the implementation chat. The design is in [unified-data-sync.md](unified-data-sync.md).

---

You are GPT-6 sol implementing the unified data synchronization redesign in `/Users/liucong/Projects/jixie`.

Read and follow `$review-gated-development` at `/Users/liucong/.codex/skills/review-gated-development/SKILL.md`. Read the actual file completely, not just this summary. Read `CLAUDE.md` completely, `CONTRIBUTING.md`, and `docs/design/unified-data-sync.md`. Read applicable frontend instructions before changing Web or Docs, and the project methodology references before changing formal factor/strategy eligibility or financial calculation semantics.

Respond to the user in Chinese. Use bilingual Chinese/English code comments as required by CLAUDE.md; keep LLM prompts/tool descriptions and commit messages in English.

## Authorization and current stage

The user has approved the product direction: replace daily, weekly, repair, import, sync-task dispatch, and canonicalize with one date-targeted sync. The user explicitly permits replacing the existing design and does not require old CLI, workflow, or protocol compatibility.

The design chat has written documentation only. Concrete implementation scope, schema/migration procedure, exact commit message, human code review, behavioral verification, and commit approval still follow the skill. Preserve approvals explicitly granted later; do not restart already completed gates.

Do not ask the user to choose daily versus weekly or revive the earlier six-command proposal. Prepare Gate 1 with concrete engineering decisions, then stop for approval.

No history compatibility does NOT authorize deleting market/user data, resetting a database, overwriting unrelated changes, or treating existing reports as disposable. Inspect the working tree and protect unrelated files. The two handoff documents belong to this task and may be updated and included in the reviewed implementation commit; unrelated review reports do not.

## Exact proposed commit message

Present this complete message at Gate 1 and settle it before implementation:

```text
feat(market)!: unify data synchronization by target date

Replace separate maintenance workflows with one date-targeted sync.
Track dataset coverage independently and compute from eligible inputs.

BREAKING CHANGE: Replace the maintenance, import:data, sync task, and
canonicalize:stock-codes entry points with data sync.
```

If the agreed scope requires another message, announce and settle it before coding. Do not silently change it at commit time.

## Fixed product contract

Implement one public market-data write operation:

```bash
pnpm data sync
pnpm data sync --to 20260915
pnpm data sync --help
```

- Freeze the default target to the Shanghai calendar date at run start. Each dataset uses its own market calendar, timezone, observation period, and source availability rules. Do not invent an unfinished daily close.
- The target is an observation-date/period upper bound, not a guarantee of complete coverage and not proof that all returned information was historically available on that date.
- An earlier target never truncates newer stored data or rolls back observed coverage. Historical corrections must still invalidate affected outputs after the target and recompute them or leave them explicitly stale.
- Different datasets may legitimately end on different dates. Preserve actual dates and availability metadata.
- Initialization, backfill, retry, late arrivals, revisions, and identity normalization are state-driven work in the same flow.
- Do not hide the old six workflows behind a new switch, class, mode flag, or wrapper. Do not add daily/weekly/import/repair/force/resume/initialize modes.
- This scope exposes no dataset selector or extra write command. Preserve reusable per-domain functions for internal use and tests.
- Keep independent backup, read-only audit, and external probe tools. Users must not need to invoke them to complete a sync.
- Migrate all root/API package commands, bootstrap/activation calls, production Node entry points and timer/service configuration to the unified operation. Use one scheduling purpose; source timing differences belong to dataset policies.

Read the design for precise summary and exit-code semantics. Report target, actual coverage, gaps, accepted changes, calculations, and errors. A partial but useful result is allowed; unexplained failures must not be hidden as normal source delay.

## Gate 1 deliverable

Perform read-only inspection only. Present:

1. Current stage, the exact commit message, the complete result, locations and callable interfaces, and affected consumers.
2. A mapping of all 24 existing sync capabilities plus necessary daily/weekly capabilities to the new flow. Do not omit financial statements/dividends, ETF shares/history, futures settlement, or identity normalization.
3. Concrete per-dataset history bounds, request partitions, completion evidence, empty/partial response semantics, revision windows, historical rechecks, retry limits, and finite batch scheduling.
4. The minimum durable state/schema: run target/result, partition coverage and unfinished work, calculation invalidation/version information. Distinguish maximum observed date from complete coverage.
5. Publication/reader consistency, transaction boundaries, stale-result handling, recovery, concurrency, old control-state retirement, and resource cleanup.
6. Required Market, Factor, Strategy, Signals, Research, cache, status API and existing UI changes. Explain local readiness checks and why normal gaps will not block the whole application.
7. Concrete schema/migration decisions, source/compiled execution paths, documentation/i18n/SQL catalog changes, deployment changes, and exact static/post-review checks.
8. Scope limits, unresolved material decisions, and conditions requiring a revised Gate 1.

Do not leave all implementation decisions abstract, and do not demand a new user decision for every routine choice. Propose the complete coherent change. Stop for the approval required by the skill. When a skill requires a stop, name/link the actual SKILL.md, quote the short applicable instruction, and identify the gate.

## Implementation constraints

### Acquisition and persistence

Do not merely remove global audit errors. Inspect each source writer's pagination, validation, delete/reinsert behavior, skip logic, and checkpoint placement.

- Accept legal independent records and persist retryable missing work. A failing source must not discard unrelated successful work.
- Partial responses merge by stable business key. Unproven empty, failed, or incomplete responses never erase existing good rows. For the same key, distinguish omitted/unknown fields from an explicit authoritative null correction: preserve known fields in the first case and apply the source contract in the second.
- Only a proven authoritative complete response may replace its exact partition. A proven complete authoritative empty set may delete that precise partition, with evidence and dependent-result invalidation. Support genuine source deletions and corrections; blindly converting everything to upsert is also wrong.
- Validate indivisible objects as a unit, such as a complete constituent-weight snapshot. Do not publish half an object as complete.
- Distinguish legitimate no-event/no-trading/no-listing cases from unknown emptiness, pagination failure, and unavailable data.
- Commit data changes, coverage/checkpoints, and affected-result invalidation consistently. The presence of any row is not completion evidence.
- Revisit earlier pending partitions after the target advances. Bound retries and schedule historical work without starving fresh data.
- Canonicalization preserves historical identity and stable keys; it is not unconditional string replacement.

### Audit and calculation

Separate record correctness, coverage/freshness, and consumer calculation eligibility.

- Invalid values/identity/time semantics still fail for the affected records or objects.
- A dataset lag does not veto unrelated valid data publication.
- A risk model's minimum sample size belongs to that model, not to the global ingestion gate.
- Same-day joins, cross-sectional comparisons, returns, and execution prices must retain explicit requirements. Never globally forward-fill yesterday's values or fill missing values with zero.
- Keep incomplete market/weather outputs missing, partial, or visibly stale as appropriate. Do not claim whole-market statistics from an unexplained changing subset.
- Review existing Factor/Strategy/Signals readers that currently exclude incomplete rows or carry values forward. Allowing partial ingestion must not silently relax formal sample/readiness rules.
- Late arrivals, changed values, source deletions, and identity changes invalidate their real dependent outputs. Respect rolling-window propagation; do not expand every update to all history.
- Calculation-version changes invalidate corresponding results even if raw data is unchanged. Audit-version changes revalidate eligibility.
- Commit a calculation result and its ready state together against a known input version/read scope. Reject stale completions. Invalidate caches for same-date corrections, not just max-date changes.

### Time and existing user results

Keep observation date, source publication/availability, and fetch time distinct. Records first publicly available after a historical decision cannot be used in that decision. Do not invent PIT metadata for latest-only backfills.

Do not automatically overwrite persisted backtests, factor reports, sealed ResearchExecution records, executed signals, accounts, trades, or user configuration. New runs can use new inputs and produce different results. A revision identifier alone is not proof that old inputs can be replayed.

Current dashboards may refresh when inputs change. Signals and factor weather consume eligible data and retain independent retry behavior. Do not create a new automatic rerun system for arbitrary user strategies or factors.

### Structure and scope

Keep the implementation in the existing API workspace. Choose clear ordinary functions and small explicit dataset policies. Do not build a generic DAG engine, plugin framework, universal Job model, separate synchronization service, or new management UI.

Keep Market domain rules in Market and cross-domain composition in the coordinator. Market must not import Strategy/Factor/Signals/Research or the coordinator. CLI parses arguments; business functions accept named input types and do not close caller-owned resources.

You may replace candidate storage, watermarks, schemas, directories and workflow internals where justified. Reuse reliable technical primitives when useful, without preserving obsolete product constraints. Explain the selected publication/read consistency mechanism in Gate 1.

Keep readers consistent while allowing independent data progress. Do not hold a database write transaction across external downloads. Partial data or an empty database must not automatically close the entire product.

Remove obsolete executable branches, command registrations, source/compiled entry references, and tests of intentionally retired behavior. Keep historical design records as history, update current navigation/instructions, and avoid unrelated refactors.

Update deployment impact mapping and its tests together only if deployable workspace/package names or cross-package build dependencies change; otherwise verify coverage. Update SQL_TABLE_DOCS whenever market schemas change, as required by CLAUDE.md. Update shared SDK/HTTP contracts when their public behavior changes.

## Static checks and Gate 2

After Gate 1 approval, implement the full agreed scope including meaningful test code. While product changes await review, run only static checks.

Inspect every combined command first. Safe examples, subject to current scripts, include tsc --noEmit, ESLint, Prettier checks, git diff --check, bash -n, node --check, and the direct backend-boundary scanner.

`pnpm check:backend-boundaries` and `pnpm check:commit-message` run self-tests and belong after review. Builds, real CLI execution (including executable help smoke tests), application modules, unit/integration/E2E tests, runtime probes, and database writes are not static checks.

Correct static errors autonomously. Do not use stale generated Prisma types or any-casts to hide schema errors; verify that necessary client generation is schema-only and does not touch a database.

Gate 2 must provide delivered behavior, the exact commit message, review entry points, schema/migration state, material risks, actual static results, and prepared but unrun verification. State explicitly that the change is uncommitted and awaits human code review.

Request approval that authorizes the listed verification and a commit with the agreed message if all required checks pass. This satisfies the repository's commit confirmation rule. Do not add an extra commit-confirmation gate after that approval.

## Prisma migration review

Use Prisma 6 to generate migrations; never handwrite or manually edit generated migration SQL, including historical migrations. `migrate dev --create-only` operates on development/shadow databases and is not static.

Default sequence:

1. First Gate 2 reviews schema, code, and tests with an explicit note that SQL is not yet generated.
2. After approval, generate the migration against isolated temporary development/shadow databases.
3. Present the newly generated migration as product code for renewed Gate 2; stop before remaining behavioral verification.
4. After approval, verify fresh installation and the approved non-destructive application to populated fixture data.

A narrow exception allowing isolated migration generation before the first review requires explicit approval in Gate 1. Do not assume it from general design approval. Never use the real development/production database or a reset as a shortcut. No legacy protocol compatibility does not excuse destructive user-data loss.

## Verification and completion

Use A01–A14 in the design as the acceptance contract. Map each requirement to meaningful tests or other concrete evidence. Include all declared datasets, partial/empty/paginated responses, source deletions, late arrivals after target advancement, PIT, calculation eligibility/version changes, same-date cache invalidation, fault-injected transaction/recovery paths, concurrency/read isolation, cleanup, and unchanged existing user artifacts.

Use temporary SQLite fixtures and controlled provider/notification substitutes. Do not call real providers, run broad sync against a user's database, send real notifications, install production services, or deploy as incidental validation.

Verify clean compiled output and actual source/compiled entry execution after review; stale dist files must not hide removed paths. Verify relevant frontend empty/partial/stale behavior when changed. Inspect and display actual E2E screenshots if E2E is performed. Clean up all temporary processes, ports, workers, and database connections.

If verification fails:

- Test/fixture/harness-only corrections within scope: fix, statically check, and rerun needed verification without new product review, provided no product changes await review.
- Product/schema/migration corrections: fix, run static checks, and return to Gate 2 before rerunning behavioral checks.
- Environment-only corrections: safely retry without an unnecessary review gate.
- Material scope/data-semantic/migration-risk changes: return to Gate 1 with evidence and an updated plan/message.

Do not weaken assertions, skip required checks, or claim unrun checks passed. Do not commit while required validation is failed or incomplete.

After all required checks pass, update the design's development record with actual evidence, inspect the final diff/status, stage only in-scope files, commit with the preannounced message, and verify the hash and remaining working-tree state. Do not push; the user handles push.

## Handoff for independent acceptance

The user will bring your completed work back to the original design chat for independent acceptance. Your own test report is development verification, not that independent acceptance.

Deliver a self-contained handoff containing:

- Commit hash and reviewed diff/base.
- Final CLI examples and product behavior, including partial/error cases.
- The mapping for all 24 capabilities and other required maintenance behavior.
- A01–A14 evidence with exact commands, fixture scenarios, outcomes, and artifact paths.
- Actual static/build/test results, generated migrations, deployment procedure, and any approved deviations.
- Process/resource cleanup, remaining workspace changes, and unresolved limitations.
- The design document's final development record with independent acceptance still marked pending.

Do not create another chat, send messages to another chat, schedule monitoring, or mark independent acceptance as passed. File/report handoff is sufficient. The user will initiate the next acceptance step.
