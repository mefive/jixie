# Implementation prompt: simplify background jobs

Copy the prompt below into the implementation task. This is an implementation handoff, not a record of completed work.

---

You are implementing the background job redesign in `/Users/liucong/Projects/jixie`.

Use `$review-gated-development` from `/Users/liucong/.codex/skills/review-gated-development/SKILL.md`. Read the actual skill before acting. Read `CLAUDE.md` completely, `CONTRIBUTING.md`, and `docs/design/job-system-simplification.md`. Follow more specific instructions for any affected application. Respond to the user in Chinese; write code comments, LLM prompts, and commit messages in English.

The user approved the design direction. The previous task was authorized to write documentation only. Product implementation, concrete migration approval, human code review, tests, and commit approval have NOT happened. Do not infer them from the design confirmation. Preserve any authorization explicitly granted later in this implementation task.

Suggested exact commit message:

```text
refactor(jobs): simplify background task execution
```

## First action: prepare Gate 1, then stop

Inspect the current working tree without changing it. Read the design and inspect the seven task implementations, their consumers, Prisma schema, bootstrap, scripts, and existing tests. Protect unrelated changes. Do not run tests, builds, services, migrations, or business workflows to prepare the briefing.

Present a concrete Gate 1 briefing containing:

1. Current stage and the exact commit message above.
2. The complete outcome, new file locations and callable interfaces, consumers, and unchanged user-facing contracts.
3. All seven task kinds, status projection and legacy data strategy, Research and Signals exceptions, schema changes, migration procedure, aliases, dependency rules, and Worker entry paths.
4. Exact static checks before review and planned behavioral verification after approval.
5. Scope boundaries, migration risks, and conditions requiring a revised plan.

Then stop for approval. Do not ask the user to reselect the already approved architectural direction. Ask only for the concrete implementation scope and message approval required by the skill. When the skill makes you stop, name and link the actual SKILL.md, quote the short applicable instruction, and explain the current gate.

## Fixed design decisions

- Use event-driven wakeups. Do not introduce periodic database polling.
- The scheduler has exactly two scheduling flags: `dispatchLoopActive` and `dispatchRequested`. Use the algorithm in the design, including clearing the request before awaiting one dispatch pass.
- A dispatch pass only selects, conditionally claims, and starts eligible work. It does not await the business computation. Keep global and per-user limits and release slots after actual resource cleanup.
- Each business task is an ordinary `async function runXxxTask(job, log)`. Parse durable input locally, compute, and save the final result through `finishJob`.
- Remove `defineJob`, `PreparedJob`, `JobResult`, lifecycle interface objects, and hidden generic input/output adapters. Do not replace them with classes, builders, plugins, a new context object, or equivalent wrappers under different names.
- Use an explicit registry of ordinary functions. Put business assembly only in `jobs/start.ts`; generic scheduler/storage/logs/worker files must not import business modules, directly or transitively.
- `runWorker` receives `start`, `onLog`, `readMessage`, and `exitedMessage`. It receives no Job, context, or database object. Pass `onLog: log` explicitly.
- `start` must return a reclaimable Worker or ChildProcess, not just an EventEmitter. Decoder/log-callback failures must stop the resource and wait for its actual exit. Preserve existing business cancellation; do not add a universal cancellation framework or new cancellation APIs.
- Initialize the log buffer once when execution starts. Save/freeze logs with the terminal transaction, preserve incremental reads and ownership, and evict after the existing retention interval.
- Preserve atomic business result plus Job finalization. A cancelled or otherwise terminal Job must reject late result publication. A task that returns while its Job is still running is a programming failure, not success.
- Keep current public Job status vocabulary and API shapes. This is not permission to rename public statuses or change scheduling/product behavior beyond the design.

## Deliver the complete scope in one coherent change

Implement all seven kinds:

```text
backtest
strategy-scan
factor-analysis
factor-correlation
signal
research-embedded-analysis
research-curator
```

Migrate infrastructure, each task, submission and read paths, state consumers, schema and generated migrations, tests, and current architecture documentation together. Do not stop after one task or leave both frameworks available. Do not introduce arbitrary delivery phases.

Use this internal work order to avoid omissions; these are work items, not separate delivery milestones:

1. Inventory every lifecycle, log, status/error, Worker, and query consumer. Record the source of truth for each relevant status field.
2. Implement the target `jobs` files and ordinary business functions. Preserve runtime ownership, resource cleanup, and transaction boundaries.
3. Implement the specified legacy fields and Job-based projections, including database-side eligibility/pagination/count queries and all consumers.
4. Update submission, cancellation, startup recovery, Signals/maintenance CLI coordination, native import aliases, boundary checks, and source/compiled Worker paths.
5. Write meaningful regression coverage for the design's acceptance matrix. Do not execute it while product code awaits review.
6. Update current documentation and instructions to match the final code. Run only permitted static checks, then submit Gate 2.
7. Generate/review migrations and run verification in the order required below. Commit only after the reviewed complete change passes all required checks.

## State and data rules: do not guess

- For Job-backed reports/runs, Job is the authoritative execution status. The design explicitly chooses legacy-field fallback for legal records without a Job. Implement that choice; do not fabricate historical Jobs, owners, payloads, logs, or times.
- BacktestReport, StrategyScanReport, SignalRun, and ResearchCuratorRun use nullable `legacyStatus` and `legacyError` mapped to the existing columns. New Job-backed rows do not dual-write those fields. FactorReport uses the specified legacyStatus and failureMessage exception.
- Remove old status defaults from legacyStatus and explicitly write null for new Job-backed records. A jobless queued/running row is a data anomaly requiring Gate 1, not a permanently active historical record or permission to invent a terminal state.
- Update every domain status filter, readiness rule, counter, dataset, and public read. Do not just change the UI mapper. Do not filter after pagination or hide historical rows with an inner join.
- ResearchExecution and ResearchCellExecution have genuine result semantics and are shared by non-Job document execution. Preserve them. `Job.done` with `ResearchExecution.error` is valid when the workflow saved a failed analysis result.
- Embedded failures, cancellation, and restart recovery must finish evidence/input records and release activeRunId atomically. Use persisted relationships even if kind or payload is corrupt.
- Signals retries reuse one SignalRun with multiple Jobs. Use `createdAt desc, id desc` consistently for the current attempt, and prevent an older attempt from publishing over a newer one.
- Preserve Factor's localized execution-failure message separately from the Job technical error; preserve holdout concealment and publication rules.
- For a linked Factor report with Job.status error, expose `failureMessage ?? job.error`; input/completion failures do not populate the Worker-specific failureMessage. Other linked statuses must not expose an old failureMessage. The Job API keeps its technical error; jobless reports preserve historical error semantics.
- Preserve the previous successful correlation cache when a new attempt fails. Curator findings, statistics, and Job completion commit or roll back together.
- Preserve Signals accounting-before-notification ordering and the error boundary for post-commit actions. Preserve the current backtest naming completion point. Do not turn awaited work into an untracked Promise.
- Keep genuine domain states such as publication, dependency staleness, deployment status, accounting, and review disposition.

If actual data or contracts contradict these rules, report the concrete conflict and return to Gate 1. Do not choose destructive fallback behavior, weaken assertions, or silently expand the scope.

## Static review gate

Inspect current package scripts before executing them. Before product-code approval, use only static formatting, lint, type checking, generated-contract consistency, and diff checks. The design records currently safe commands and wrappers that secretly execute tests.

In particular:

- Root `pnpm typecheck` currently performs static checks.
- `pnpm check:backend-boundaries` and `pnpm check:commit-message` run self-tests first and belong after review. Use their direct static scripts if needed before review.
- Tests, builds, smoke checks, E2E, server startup, database writes, and application execution are forbidden while product changes await review.
- Necessary Prisma client generation must be checked to be schema-only generation with no database operation. Do not use `any` to hide stale generated types.

Correct static issues until clean. Gate 2 must state the delivered behavior, exact commit message, review entry points, material risks, actual static results, and prepared but unrun behavioral verification. Explicitly state that changes are uncommitted and await human review.

Ask for review approval that authorizes the listed verification and a commit with the preannounced message if all required checks pass. That approval also satisfies the repository's commit confirmation requirement. Do not add another confirmation after approval unless the user explicitly limits that authorization.

## Migration generation has its own review requirement

Follow Prisma 6 and the repository rule: migrations must be generated by Prisma; never handwrite or edit generated migration SQL.

`prisma migrate dev --create-only` operates on development/shadow databases. It is not a static check. Default sequence:

1. Submit schema, mapping, product code, and test code for Gate 2 with static results; disclose that migration SQL is not yet generated.
2. After approval, use only isolated temporary databases to establish the old baseline and generate the migration.
3. Treat the generated SQL as newly added product code. Present it for renewed Gate 2 and stop before the remaining behavioral verification.
4. After SQL approval, run migration/upgrade regression and the rest of the planned verification.

Only an explicit user-approved exception at Gate 1 may allow isolated migration generation before the first review. Design approval alone does not grant that exception. Do not touch live or default development data. Do not use db push as evidence of a correct upgrade.

## Verification, corrections, and completion

Use the acceptance matrix in the design. Cover wakeup interleavings, conditional claims, concurrency/slot cleanup, all seven task outcomes, atomic rollback, corrupt metadata, cancellation, Worker lifecycle, log persistence, legacy records, current Signals attempts, Research result semantics, and real source/compiled startup paths.

Update the `#jobs/*` mapping and boundary checker, including its tests. Update both source classification and allowed-target classification: permit generic jobs files to depend on each other and approved infra/pure utilities, but prohibit direct or transitive business imports through start.ts. Do not accidentally exempt all of jobs from dependency rules. Verify production loading with clean build outputs so old dist files cannot hide stale imports. Keep Node development conditions and relative Worker URLs correct.

Use temporary SQLite fixtures and controlled LLM/notification substitutes. Never send real notifications or run trading/maintenance/data-sync workflows as accidental validation. Clean up temporary processes, ports, Workers, and database connections. If you run E2E, inspect and display the resulting screenshots in the final response.

When validation fails:

- Test-only/fixture/harness corrections within scope: fix, statically check, and rerun the necessary tests without requesting another human review, provided no product changes are awaiting review.
- Product/schema/migration corrections: fix, run static checks, return to Gate 2, and wait before rerunning behavioral verification.
- Environment-only corrections: retry safely without an unnecessary review gate.
- Material scope, data semantics, security, or migration-risk changes: return to Gate 1 with evidence and a revised plan/message if needed.

Never weaken tests, skip a required failing check, claim unrun verification passed, or commit an incomplete result. Record actual results in the design's implementation record. Inspect the final diff and stage only in-scope files, including authorized test corrections. After all required checks pass and review/commit authorization exists, commit directly with the agreed message and report its hash and remaining workspace state. Do not push or deploy; the user handles push.

Keep progress updates concise. Explain what changed, why it matters, and what remains to be verified. Optimize for readable ordinary code, not minimum line count or maximum reuse.
