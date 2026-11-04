import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getDatabase } from '#infra/database/prisma.js';
import {
  readDiagnosticMigrations,
  readDiagnosticTableSchema,
} from '#infra/database/diagnostic-schema.js';
import { loadMarketDiagnosticContext } from '#market/synchronization/diagnostic-context.js';
import { dividendReceiptHasCompleteFields } from '#market/fundamentals/dividend-identity.js';
import { latestAttempts, unitKey } from './runs.js';
import { parseRunPlan, runPlanSchema } from './schema.js';
import { IngestionError } from './errors.js';
import { diagnosticJson } from './diagnostic-json.js';
import {
  diagnosticBundleSchema,
  issueExportInputSchema,
  type DiagnosticBundle,
  type IssueClassification,
  type IssueExportInput,
} from './issue-export-schema.js';

/**
 * 在同一个只读查询事务内导出有效诊断、实际 schema 和相关业务行。
 *
 * Export effective diagnostics, actual schema and related rows in one read-only query transaction.
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
        const run = await database.ingestionRun.findUnique({ where: { id: request.runId } });
        if (!run) {
          throw new IngestionError('export_run_not_found');
        }
        const revision = await database.marketDataState.findUnique({ where: { key: 'global' } });
        const planResult = runPlanSchema.safeParse(run.scopeSnapshot);
        const plan = planResult.success ? parseRunPlan(run.scopeSnapshot) : null;
        const units = [
          ...(plan?.referenceUnits ?? []),
          ...(plan?.selectionUnits ?? []),
          ...(plan?.plan?.units ?? []),
        ];
        const unitMap = new Map(units.map((unit) => [unitKey(unit), unit]));
        const planComplete = Boolean(plan?.selectionUnits && plan.plan);
        const attempts = await database.ingestionBatch.findMany({
          where: { runId: run.id },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            dataset: true,
            scope: true,
            period: true,
            status: true,
            rejectedCount: true,
            startedAt: true,
          },
        });
        const latest = latestAttempts(attempts);
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
        const issues = await database.ingestionIssue.findMany({
          where: { runId: run.id },
          include: { batch: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        const classified = issues.map(({ batch, ...issue }) => {
          let classification: IssueClassification = 'current';
          let reason = 'latest_attempt_in_current_plan';
          if (!batch) {
            classification = 'run_level_unknown';
            reason = 'run_level_issue_has_no_attempt_identity';
          } else if (latest.get(unitKey(batch))?.id !== batch.id) {
            classification = 'superseded_attempt';
            reason = 'a_newer_attempt_exists_for_this_logical_unit';
          } else if (!unitMap.has(unitKey(batch))) {
            classification = planComplete ? 'obsolete_unit' : 'unknown_plan';
            reason = planComplete
              ? 'unit_not_in_current_saved_plan'
              : 'saved_plan_does_not_prove_unit_membership';
          } else if (
            batch.dataset === 'dividends' &&
            batch.status === 'succeeded' &&
            !dividendReceiptHasCompleteFields(batch.request)
          ) {
            classification = 'incomplete_dividend_receipt';
            reason = 'success_receipt_did_not_request_complete_dividend_fields';
          }

          return { issue, batch, classification, reason };
        });
        const historical = classified.filter((item) =>
          ['superseded_attempt', 'obsolete_unit'].includes(item.classification),
        );
        const active = classified.filter(
          (item) => !['superseded_attempt', 'obsolete_unit'].includes(item.classification),
        );
        const selected = request.issueId
          ? active.filter((item) => item.issue.id === request.issueId)
          : active;
        if (request.issueId && !selected.length) {
          throw new IngestionError('export_issue_not_current');
        }
        const items = [];
        const tableNames = new Set([
          'IngestionRun',
          'IngestionBatch',
          'IngestionIssue',
          'MarketDataState',
        ]);
        for (const item of selected) {
          const unit = item.batch ? unitMap.get(unitKey(item.batch)) : undefined;
          const context = await loadMarketDiagnosticContext(database, {
            dataset: item.batch?.dataset ?? 'run-level',
            scope: item.batch?.scope ?? '',
            period: item.batch?.period ?? '',
            startDate: unit?.startDate ?? item.batch?.rangeStart,
            endDate: unit?.endDate ?? item.batch?.rangeEnd,
            businessKey: item.issue.businessKey,
            payload: item.issue.payload,
          });
          for (const table of context.tableNames) {
            tableNames.add(table);
          }
          items.push({
            issue: item.issue,
            classification: item.classification,
            classificationReason: item.reason,
            batch: item.batch,
            unit: unit ?? null,
            context,
          });
        }
        const tableSchemas = [];
        for (const table of [...tableNames].sort()) {
          tableSchemas.push(await readDiagnosticTableSchema(database, table));
        }
        const migrations = await readDiagnosticMigrations(database);
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
          'mapped_repair_candidates_require_an_admission_decision',
          'historical_attempt_code_versions_not_recorded',
          ...(!planComplete ? ['saved_plan_is_incomplete_or_unsupported'] : []),
          ...(!request.code.commit ? ['code_commit_unavailable'] : []),
          ...(request.code.sourceDirty ? ['source_differs_from_recorded_commit'] : []),
          ...(request.code.commit && request.code.sourceDirty === null
            ? ['source_worktree_state_unavailable']
            : []),
          ...(!migrations.available ? ['migration_receipts_unavailable'] : []),
          ...(tableSchemas.some((table) => !table.exists) ? ['referenced_table_missing'] : []),
        ];
        const bundle = {
          format: 'jixie-ingestion-diagnostics',
          version: 1,
          manifest: {
            exportedAt: new Date().toISOString(),
            snapshotConsistency: 'single_transaction',
            code: request.code,
            codeIdentityScope: 'exporting_workspace_not_historical_attempts',
            schemaFingerprint: createHash('sha256')
              .update(JSON.stringify({ tableSchemas, migrations }))
              .digest('hex'),
            schemaFingerprintScope: 'exported_tables_and_applied_migrations',
            migrations,
            marketRevision: revision?.revision ?? null,
            redacted: true,
            valueSerialization: {
              dateTime: 'ISO_8601_from_Prisma',
              sqlLiteralsRequireStorageVerification: true,
            },
          },
          run: { ...run, summaryMayBeStale: run.status === 'running' },
          selection: {
            requestedIssueId: request.issueId ?? null,
            planComplete,
            currentPlan: plan,
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
          },
          items,
          historicalIssues: historical.map((item) => ({
            id: item.issue.id,
            batchId: item.issue.batchId,
            severity: item.issue.severity,
            reasonCode: item.issue.reasonCode,
            classification: item.classification,
            classificationReason: item.reason,
            logicalUnit: item.batch
              ? { dataset: item.batch.dataset, scope: item.batch.scope, period: item.batch.period }
              : null,
            latestAttemptId: item.batch ? (latest.get(unitKey(item.batch))?.id ?? null) : null,
          })),
          tableSchemas,
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
