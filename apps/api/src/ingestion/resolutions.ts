import pkg, { type Prisma } from '@prisma/client';
import { z } from 'zod';
import { getDatabase } from '#infra/database/prisma.js';
import { withMaintenanceLock } from '#infra/coordination/market-access.js';
import { loadMarketDiagnosticContext } from '#market/synchronization/diagnostic-context.js';
import { diagnosticJson } from './diagnostic-json.js';
import { readRunIssueState, type ActiveIssue } from './issue-state.js';
import { IngestionError } from './errors.js';
import {
  recordIssueResolutionSchema,
  resolutionRowsSchema,
  resolutionStatusSchema,
  type RecordIssueResolutionInput,
  type ResolutionRows,
} from './resolution-schema.js';

/**
 * 仅补齐已结束运行的有效／未知问题，重复调用绝不重置已有处理记录。
 *
 * Reconcile effective/unknown issues of a finished run without resetting any existing handling.
 */
export async function ensureRunIssueResolutions(database: Prisma.TransactionClient, runId: string) {
  const state = await readRunIssueState(database, runId);
  if (state.run.status === 'running' || !state.run.finishedAt) {
    return { runId, created: 0, skippedRunning: true };
  }
  let created = 0;
  for (const item of state.active) {
    if (item.resolution) {
      continue;
    }
    await database.ingestionIssueResolution.upsert({
      where: { issueId: item.issue.id },
      create: { issueId: item.issue.id },
      update: {},
    });
    created++;
  }

  return { runId, created, skippedRunning: false };
}

/**
 * 显式维护命令补齐历史运行；读接口不写库，也不需要常驻扫描任务。
 *
 * An explicit maintenance command reconciles old runs; read endpoints never write or schedule scans.
 */
export async function reconcileIssueResolutions(runId?: string) {
  return withMaintenanceLock(async () => {
    const database = getDatabase();
    const runs = runId
      ? [{ id: runId }]
      : await database.ingestionRun.findMany({
          where: { status: { not: 'running' }, issues: { some: {} } },
          select: { id: true },
          orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        });
    const results = [];
    for (const run of runs) {
      results.push(
        await database.$transaction(
          (transaction) => ensureRunIssueResolutions(transaction, run.id),
          { timeout: 120_000 },
        ),
      );
    }

    return { runs: results, created: results.reduce((count, result) => count + result.created, 0) };
  });
}

async function verifyRows(
  database: Prisma.TransactionClient,
  item: ActiveIssue,
  expected: ResolutionRows,
) {
  if (!item.batch) {
    return 'unknown' as const;
  }
  const context = await loadMarketDiagnosticContext(database, {
    dataset: item.batch.dataset,
    scope: item.batch.scope,
    period: item.batch.period,
    startDate: item.batch.rangeStart,
    endDate: item.batch.rangeEnd,
    businessKey: item.issue.businessKey,
    payload: item.issue.payload,
  });
  for (const expectation of expected) {
    const table = context.tables.find((candidate) => candidate.table === expectation.table);
    if (!table?.complete) {
      return 'unknown' as const;
    }
    const rows = table.rows.map((row) => diagnosticJson(row));
    const matches = rows.filter((row) => matchesFields(row, expectation.key));
    const matchesExpectation =
      expectation.values === null
        ? matches.length === 0
        : matches.length === 1 && matchesFields(matches[0], expectation.values);
    if (!matchesExpectation) {
      return 'changed' as const;
    }
  }

  return 'verified' as const;
}

function matchesFields(row: unknown, fields: Record<string, unknown>): boolean {
  if (!row || typeof row !== 'object') {
    return false;
  }

  return Object.entries(fields).every(
    ([key, value]) => Object.hasOwn(row, key) && Reflect.get(row, key) === value,
  );
}

/**
 * 已证实的覆盖变化返回待处理，证据不足则待复核。
 *
 * Reopen confirmed changes as pending and distinguish evidence that still needs review.
 */
export async function readIssueHandling(database: Prisma.TransactionClient, item: ActiveIssue) {
  const stored = item.resolution;
  const status = resolutionStatusSchema.parse(stored?.status ?? 'pending');
  let verification: 'verified' | 'changed' | 'unknown' | null = null;
  if (status === 'resolved') {
    const after = resolutionRowsSchema.safeParse(stored?.after);
    verification = after.success ? await verifyRows(database, item, after.data) : 'unknown';
  }

  const handling = status === 'resolved' && verification !== 'verified' ? 'pending' : status;
  const needsReview =
    handling === 'pending' && (item.classification !== 'current' || verification === 'unknown');

  return {
    status: needsReview ? ('review' as const) : handling,
    storedStatus: status,
    verification,
    recordExists: Boolean(stored),
    reason: stored?.reason ?? null,
    resolvedAt: stored?.resolvedAt?.toISOString() ?? null,
    marketRevision: stored?.marketRevision ?? null,
  };
}

/**
 * 只接受调用方的写事务；核验最终字段与实时 revision 后登记，不执行任意修复 SQL。
 *
 * Require the caller's write transaction, verify final fields/revision and record handling without executing arbitrary SQL.
 */
export async function recordIssueResolution(
  database: Prisma.TransactionClient,
  input: RecordIssueResolutionInput,
) {
  const request = recordIssueResolutionSchema.parse(input);
  const issue = await database.ingestionIssue.findUnique({
    where: { id: request.issueId },
    select: { runId: true },
  });
  if (!issue) {
    throw new IngestionError('export_issue_not_current');
  }
  const state = await readRunIssueState(database, issue.runId);
  const item = state.active.find((candidate) => candidate.issue.id === request.issueId);
  if (!item || state.run.status === 'running' || !state.run.finishedAt) {
    throw new IngestionError('resolution_not_ready');
  }
  const revision = await database.marketDataState.findUnique({ where: { key: 'global' } });
  if (revision?.revision !== request.marketRevision) {
    throw new IngestionError('resolution_verification_failed');
  }
  if (
    request.status === 'resolved' &&
    (await verifyRows(database, item, request.after)) !== 'verified'
  ) {
    throw new IngestionError('resolution_verification_failed');
  }
  const previous = item.resolution;
  let history: Prisma.InputJsonValue[] = previous
    ? (z.array(z.unknown()).parse(previous.history) as Prisma.InputJsonValue[])
    : [];
  const previousVersion =
    previous && previous.status !== 'pending' ? previous.updatedAt.toISOString() : undefined;
  if (request.previousResolutionUpdatedAt !== previousVersion) {
    throw new IngestionError('resolution_already_handled');
  }
  if (previous && (previousVersion || previous.reason)) {
    // 再次修复先保留上一次结论，不能覆盖掉原来的证据。
    // Preserve the previous decision and evidence before repairing a changed result again.
    const { history: _history, ...snapshot } = previous;
    history = [...history, diagnosticJson(snapshot) as Prisma.InputJsonValue];
  }
  const data = {
    status: request.status,
    reason: String(diagnosticJson(request.reason)),
    evidence: diagnosticJson(
      request.receipt ? { sources: request.evidence, receipt: request.receipt } : request.evidence,
    ) as Prisma.InputJsonValue,
    history,
    before: request.status === 'resolved' ? request.before : pkg.Prisma.DbNull,
    after: request.status === 'resolved' ? request.after : pkg.Prisma.DbNull,
    marketRevision: request.marketRevision,
    resolvedAt: request.status === 'pending' ? null : new Date(),
  };

  return database.ingestionIssueResolution.upsert({
    where: { issueId: request.issueId },
    create: { issueId: request.issueId, ...data },
    update: data,
  });
}
