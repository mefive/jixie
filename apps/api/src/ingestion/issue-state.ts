import type { Prisma } from '@prisma/client';
import { dividendReceiptHasCompleteFields } from '#market/fundamentals/dividend-identity.js';
import { latestAttempts, unitKey } from './runs.js';
import { parseRunPlan, runPlanSchema } from './schema.js';
import { IngestionError } from './errors.js';
import { issueCoverageReader } from './issue-coverage.js';
import type { IssueClassification } from './issue-export-schema.js';

const attemptOrdering = [
  { startedAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.IngestionBatchOrderByWithRelationInput[];
const attemptFields = {
  id: true,
  dataset: true,
  scope: true,
  period: true,
  status: true,
  rejectedCount: true,
  startedAt: true,
} satisfies Prisma.IngestionBatchSelect;

/**
 * 前端、诊断包及补齐入口共用当前计划／最近尝试口径；未知有效性仍保留。
 *
 * Share saved-plan/latest-attempt classification across UI, exports and reconciliation; retain unknowns.
 */
export async function readRunIssueState(
  database: Prisma.TransactionClient,
  runId: string,
  includeAllAttempts = false,
) {
  const run = await database.ingestionRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      targetDate: true,
      scopeSnapshot: true,
      status: true,
      summary: true,
      startedAt: true,
      finishedAt: true,
    },
  });
  if (!run) {
    throw new IngestionError('export_run_not_found');
  }
  const parsed = runPlanSchema.safeParse(run.scopeSnapshot);
  const plan = parsed.success ? parseRunPlan(run.scopeSnapshot) : null;
  const units = [
    ...(plan?.referenceUnits ?? []),
    ...(plan?.selectionUnits ?? []),
    ...(plan?.plan?.units ?? []),
  ];
  const unitMap = new Map(units.map((unit) => [unitKey(unit), unit]));
  const planComplete = Boolean(plan?.selectionUnits && plan.plan);
  const issues = await database.ingestionIssue.findMany({
    where: { runId },
    include: { batch: true, resolution: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const attempts = includeAllAttempts
    ? await database.ingestionBatch.findMany({
        where: { runId },
        orderBy: attemptOrdering,
        select: attemptFields,
      })
    : [];
  const latest = latestAttempts(attempts);

  // 状态轮询只查询实际有诊断的逻辑批次，不读取整轮行情收据。
  // Status polling checks only logical batches that have diagnostics.
  if (!includeAllAttempts) {
    const issueBatches = new Map(
      issues.flatMap(({ batch }) => (batch ? [[unitKey(batch), batch] as const] : [])),
    );
    for (const [key, { dataset, scope, period }] of issueBatches) {
      const attempt = await database.ingestionBatch.findFirst({
        where: { runId, dataset, scope, period },
        orderBy: attemptOrdering,
        select: attemptFields,
      });
      if (attempt) {
        latest.set(key, attempt);
      }
    }
  }

  const checkCoverage = issueCoverageReader(database, run);
  const classified = await Promise.all(
    issues.map(async ({ batch, resolution, ...issue }) => {
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

      const coverage =
        batch &&
        !isHistoricalIssue(classification) &&
        (!resolution || resolution.status === 'pending')
          ? await checkCoverage(batch, issue)
          : null;
      if (coverage) {
        classification = 'covered_by_later_run';
        reason = coverage.reason;
      }

      return { issue, batch, resolution, classification, reason, coverage };
    }),
  );
  const historical = classified.filter((item) => isHistoricalIssue(item.classification));
  const active = classified.filter((item) => !isHistoricalIssue(item.classification));

  return { run, plan, unitMap, planComplete, attempts, latest, classified, historical, active };
}

export type RunIssueState = Awaited<ReturnType<typeof readRunIssueState>>;
export type ActiveIssue = RunIssueState['active'][number];

export function isHistoricalIssue(classification: IssueClassification): boolean {
  return (
    classification === 'superseded_attempt' ||
    classification === 'obsolete_unit' ||
    classification === 'covered_by_later_run'
  );
}
