import { z } from 'zod';
import { getDatabase } from '#infra/database/prisma.js';
import { readRepairContext, repairIssueTemplates } from './repair-context.js';
import { describeIssueRepairPlan } from './repair-schema.js';
import { dividendReceiptHasCompleteFields } from '#market/fundamentals/dividend-identity.js';
import { unitKey } from './runs.js';
import { readRunIssueState } from './issue-state.js';
import { readIssueHandling } from './resolutions.js';
import { emptyIssueCounts, addIssueHandling } from './issue-overview.js';
import { IngestionError } from './errors.js';
import { diagnosticJson } from './diagnostic-json.js';
import {
  diagnosticBundleSchema,
  issueExportInputSchema,
  type DiagnosticBundle,
  type IssueExportInput,
} from './issue-export-schema.js';

/**
 * 在同一个只读查询事务内导出有效诊断、业务字段和修复契约。
 *
 * Export effective diagnostics, business fields and repair contract in one read-only transaction.
 */
export async function exportIngestionIssues(input: IssueExportInput): Promise<DiagnosticBundle> {
  const request = issueExportInputSchema.parse(input);

  return getDatabase().$transaction(
    async (database) => {
      const readOnlyState = z
        .array(z.object({ query_only: z.coerce.number().int().min(0).max(1) }))
        .parse(await database.$queryRaw`PRAGMA query_only`);
      const wasReadOnly = readOnlyState[0]?.query_only;
      if (wasReadOnly == null) {
        throw new Error('SQLite query-only state is unavailable');
      }
      await database.$executeRaw`PRAGMA query_only = ON`;
      try {
        const revision = await database.marketDataState.findUnique({ where: { key: 'global' } });
        const state = await readRunIssueState(database, request.runId, true);
        const {
          run,
          plan,
          unitMap,
          planComplete,
          attempts,
          latest,
          classified,
          historical,
          active,
        } = state;
        const dividendReceipts = await database.ingestionBatch.findMany({
          where: { runId: run.id, dataset: 'dividends', status: 'succeeded' },
          select: { id: true, request: true },
        });
        const completeDividendReceipts = new Set(
          dividendReceipts
            .filter((batch) => dividendReceiptHasCompleteFields(batch.request))
            .map((batch) => batch.id),
        );
        const attemptById = new Map(attempts.map((batch) => [batch.id, batch]));
        const selected = request.issueId
          ? active.filter((item) => item.issue.id === request.issueId)
          : active;
        if (request.issueId && !selected.length) {
          throw new IngestionError('export_issue_not_current');
        }
        const items = [];
        const handlingCounts = emptyIssueCounts();
        const handlingById = new Map();
        const reviewDiagnostics = { error: 0, warning: 0 };
        for (const item of active) {
          const handling = await readIssueHandling(database, item);
          handlingById.set(item.issue.id, handling);
          addIssueHandling(handlingCounts, item.issue.severity, handling.status);
          if (handling.status === 'review') {
            reviewDiagnostics[item.issue.severity === 'warning' ? 'warning' : 'error']++;
          }
        }
        const datasets = new Set<string>();
        const finished = run.status !== 'running' && Boolean(run.finishedAt);
        for (const item of selected) {
          const context = await readRepairContext(database, item);
          if (context.dataset) {
            datasets.add(context.dataset);
          }
          const handling = handlingById.get(item.issue.id)!;
          const templates = repairIssueTemplates(
            item,
            context,
            finished && request.dataLocation !== 'published',
          );
          items.push({
            issue: {
              id: item.issue.id,
              runId: item.issue.runId,
              batchId: item.issue.batchId,
              category: item.issue.category,
              severity: item.issue.severity,
              reasonCode: item.issue.reasonCode,
              message: item.issue.message,
              field: item.issue.field,
              payload: item.issue.payload,
              createdAt: item.issue.createdAt,
            },
            classification: item.classification,
            classificationReason: item.reason,
            batch: item.batch
              ? {
                  id: item.batch.id,
                  dataset: item.batch.dataset,
                  scope: item.batch.scope,
                  period: item.batch.period,
                  api: item.batch.api,
                  request: item.batch.request,
                  status: item.batch.status,
                  responseComplete: item.batch.responseComplete,
                  receivedCount: item.batch.receivedCount,
                  acceptedCount: item.batch.acceptedCount,
                  filteredCount: item.batch.filteredCount,
                  rejectedCount: item.batch.rejectedCount,
                }
              : null,
            unit: item.batch ? (unitMap.get(unitKey(item.batch)) ?? null) : null,
            context: {
              ...context,
              templates,
              allowedOperations: [...new Set(templates.map((template) => template.op))],
            },
            resolution: item.resolution
              ? {
                  status: item.resolution.status,
                  reason: item.resolution.reason,
                  evidence:
                    item.resolution.evidence &&
                    typeof item.resolution.evidence === 'object' &&
                    !Array.isArray(item.resolution.evidence)
                      ? (item.resolution.evidence.sources ?? null)
                      : item.resolution.evidence,
                  resolvedAt: item.resolution.resolvedAt,
                  updatedAt: item.resolution.updatedAt,
                  marketRevision: item.resolution.marketRevision,
                }
              : null,
            handling,
          });
        }
        const countSeverity = (values: typeof classified) => ({
          error: values.filter((item) => item.issue.severity !== 'warning').length,
          warning: values.filter((item) => item.issue.severity === 'warning').length,
        });
        const effective = [...latest.values()].filter((batch) => unitMap.has(unitKey(batch)));
        const batchCounts = {
          total: effective.length,
          succeeded: effective.filter(
            (batch) =>
              batch.status === 'succeeded' &&
              (batch.dataset !== 'dividends' || completeDividendReceipts.has(batch.id)),
          ).length,
          incompleteSuccessReceipts: effective.filter(
            (batch) =>
              batch.status === 'succeeded' &&
              batch.dataset === 'dividends' &&
              !completeDividendReceipts.has(batch.id),
          ).length,
          partial: effective.filter((batch) => batch.status === 'partial').length,
          failed: effective.filter((batch) => batch.status === 'failed').length,
          running: effective.filter((batch) => batch.status === 'running').length,
          interrupted: effective.filter((batch) => batch.status === 'interrupted').length,
          rejectedRecords: effective.reduce((count, batch) => count + batch.rejectedCount, 0),
        };
        const limitations = [
          'historical_attempt_code_versions_not_recorded',
          ...(!planComplete ? ['saved_plan_is_incomplete_or_unsupported'] : []),
          ...(!request.code.commit ? ['code_commit_unavailable'] : []),
          ...(request.code.sourceDirty ? ['source_differs_from_recorded_commit'] : []),
          ...(request.code.commit && request.code.sourceDirty === null
            ? ['source_worktree_state_unavailable']
            : []),
        ];
        const bundle = {
          format: 'jixie-ingestion-diagnostics',
          manifest: {
            exportedAt: new Date().toISOString(),
            snapshotConsistency: 'single_transaction',
            code: request.code,
            codeIdentityScope: 'exporting_workspace_not_historical_attempts',
            dataLocation: request.dataLocation ?? 'published',
            marketRevision: revision?.revision ?? null,
            redacted: true,
          },
          run: {
            id: run.id,
            status: run.status,
            targetDate: run.targetDate,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            summary: run.summary,
            summaryMayBeStale: run.status === 'running',
          },
          selection: {
            requestedIssueId: request.issueId ?? null,
            planComplete,
            blockedUnits: plan?.plan?.blocked ?? [],
            latestAttemptOrdering: ['startedAt DESC', 'id DESC'],
            standaloneIssues: 'unknown_without_attempt_identity',
            dividendReceiptFields: 'complete_source_fields_required_for_reuse',
            batchCountsExcludeCrossRunReusedReceipts: true,
            effectiveAttemptEvidence: [
              ...new Set(active.flatMap((item) => (item.batch ? [item.batch.id] : []))),
            ].map((id) => attemptById.get(id)),
          },
          counts: {
            allRunDiagnostics: countSeverity(classified),
            currentDiagnostics: countSeverity(
              active.filter((item) => item.classification === 'current'),
            ),
            unknownOrIncompleteDiagnostics: countSeverity(
              active.filter((item) => item.classification !== 'current'),
            ),
            historicalDiagnostics: countSeverity(historical),
            selectedDiagnostics: countSeverity(selected),
            effectiveBatchesInThisRun: batchCounts,
            plannedUnits: unitMap.size,
            handling: handlingCounts,
            reviewDiagnostics,
          },
          items,
          historicalIssues: historical.map((item) => ({
            id: item.issue.id,
            batchId: item.issue.batchId,
            severity: item.issue.severity,
            reasonCode: item.issue.reasonCode,
            classification: item.classification,
            classificationReason: item.reason,
            coverage: item.coverage,
            logicalUnit: item.batch
              ? { dataset: item.batch.dataset, scope: item.batch.scope, period: item.batch.period }
              : null,
            latestAttemptId: item.batch ? (latest.get(unitKey(item.batch))?.id ?? null) : null,
          })),
          repairContract: {
            command: 'pnpm data issues repair --plan FILE',
            applyOptions: '--apply --expect-plan PLAN_HASH',
            plan: describeIssueRepairPlan(datasets),
            note: 'Templates need evidence, a reason and any requested business values. Use only allowed operations for each issue.',
          },
          limitations,
        };

        return diagnosticBundleSchema.parse(diagnosticJson(bundle));
      } finally {
        if (wasReadOnly === 0) {
          await database.$executeRaw`PRAGMA query_only = OFF`;
        }
      }
    },
    { timeout: 120_000 },
  );
}
