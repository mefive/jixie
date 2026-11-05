import type { Prisma } from '@prisma/client';
import { getDatabase } from '#infra/database/prisma.js';
import type {
  IngestionHealth,
  IngestionIssueList,
  IssueHandlingCounts,
  IngestionIssueListInput,
} from '@jixie/shared/api/ingestion';
import { readRunIssueState } from './issue-state.js';
import { readIssueHandling } from './resolutions.js';
import { diagnosticJson } from './diagnostic-json.js';
import { ingestionExecutionSchema } from './schema.js';

export function emptyIssueCounts(): IssueHandlingCounts {
  return {
    pending: { error: 0, warning: 0 },
    resolved: { error: 0, warning: 0 },
    accepted: { error: 0, warning: 0 },
  };
}

export function addIssueHandling(
  counts: IssueHandlingCounts,
  severity: string,
  status: keyof IssueHandlingCounts | 'review',
): void {
  if (status !== 'review') {
    counts[status][severity === 'warning' ? 'warning' : 'error']++;
  }
}

/**
 * 旧问题有覆盖证据才归档，待复核单独计数。
 *
 * Archive older issues only with coverage evidence and count review separately.
 */
export async function readIssueOverview(
  database: Prisma.TransactionClient,
  latestRunId?: string | null,
  details = false,
) {
  const runs = await database.ingestionRun.findMany({
    where: { OR: [{ issues: { some: {} } }, ...(latestRunId ? [{ id: latestRunId }] : [])] },
    select: { id: true },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
  });
  const health: IngestionHealth = {
    latestRun: null,
    handling: emptyIssueCounts(),
    unknownValidity: 0,
    coveredHistorical: 0,
    missingResolutionRecords: 0,
  };
  const items: IngestionIssueList['items'] = [];
  let latestError: string | null = null;
  for (const run of runs) {
    const state = await readRunIssueState(database, run.id);
    const counts = emptyIssueCounts();
    health.coveredHistorical += state.historical.filter((item) => item.coverage).length;
    for (const item of state.active) {
      const handling = await readIssueHandling(database, item);
      addIssueHandling(counts, item.issue.severity, handling.status);
      addIssueHandling(health.handling, item.issue.severity, handling.status);
      health.unknownValidity += handling.status === 'review' ? 1 : 0;
      health.missingResolutionRecords += item.resolution ? 0 : 1;
      if (
        run.id === latestRunId &&
        handling.status === 'pending' &&
        item.issue.severity !== 'warning' &&
        item.issue.category !== 'internal'
      ) {
        latestError = String(diagnosticJson(item.issue.message)).slice(0, 500);
      }
      if (details) {
        items.push({
          id: item.issue.id,
          runId: run.id,
          targetDate: state.run.targetDate,
          severity: item.issue.severity === 'warning' ? 'warning' : 'error',
          dataset: item.batch?.dataset ?? null,
          scope: item.batch?.scope ?? null,
          period: item.batch?.period ?? null,
          businessKey:
            item.issue.businessKey == null
              ? null
              : JSON.stringify(diagnosticJson(item.issue.businessKey)).slice(0, 300),
          reasonCode: item.issue.reasonCode,
          message:
            item.issue.category === 'internal'
              ? ''
              : String(diagnosticJson(item.issue.message)).slice(0, 500),
          status: handling.status,
          verification: handling.verification,
          handlingReason: handling.reason
            ? String(diagnosticJson(handling.reason)).slice(0, 500)
            : null,
          resolvedAt: handling.resolvedAt,
        });
      }
    }
    if (run.id === latestRunId) {
      const execution = ingestionExecutionSchema.safeParse(state.run.summary);
      health.latestRun = {
        id: run.id,
        status: state.run.status,
        targetDate: state.run.targetDate,
        finishedAt: state.run.finishedAt?.toISOString() ?? null,
        execution: state.run.status === 'running' || !execution.success ? null : execution.data,
        handling: counts,
      };
    }
  }
  items.sort((left, right) => {
    const priority = { pending: 0, review: 1, resolved: 2, accepted: 3 };

    return priority[left.status] - priority[right.status] || left.id.localeCompare(right.id);
  });

  return { health, items, latestError };
}

/** 已登录用户的安全摘要，不返回来源 payload。 / Safe authenticated summaries without source payloads. */
export async function getIngestionIssueList(
  input: IngestionIssueListInput,
): Promise<IngestionIssueList> {
  const result = await getDatabase().$transaction(
    (transaction) => readIssueOverview(transaction, null, true),
    { timeout: 120_000 },
  );

  return {
    total: result.items.length,
    offset: input.offset,
    limit: input.limit,
    items: result.items.slice(input.offset, input.offset + input.limit),
  };
}
