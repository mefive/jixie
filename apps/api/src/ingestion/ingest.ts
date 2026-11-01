import { ulid } from 'ulid';
import { IngestionError } from './errors.js';
import { getDatabase } from '#infra/database/prisma.js';
import { withMaintenanceLock, withMarketPublication } from '#infra/coordination/market-access.js';
import { withSourceRequestBudget } from '#market/providers/source-fetch.js';
import { isObservationDate, localDate } from '#market/synchronization/date.js';
import { prepareMarketPartition, writeMarketPartition } from '#market/synchronization/prepare.js';
import {
  withImportDiagnostics,
  type ImportDiagnostics,
  type ImportIssue,
} from '#market/synchronization/diagnostics.js';
import { fetchLatestSizes } from '#market/downloads/select-etfs.js';
import { initializeIndexDownloads, readDownloadCodes } from '#market/downloads/lists.js';
import type { PreparedMarketPartition } from '#market/synchronization/partition.js';
import { compactSuccessfulReceipts } from './receipts.js';
import { planIngestion, referenceUnits } from './plan.js';
import type { IngestionInput, IngestionResult, IngestionUnit } from './schema.js';

/**
 * 固定目标、整批下载和短事务接纳；成功批次即恢复依据。
 *
 * Freeze the target, download complete batches and publish atomically; receipts drive recovery.
 */
export async function ingest(input: IngestionInput): Promise<IngestionResult> {
  if (!isObservationDate(input.targetDate)) {
    throw new IngestionError('invalid_target_date');
  }
  const database = getDatabase();
  const clock = input.clock ?? (() => new Date());
  const startedAt = clock();
  const signal = input.signal ?? new AbortController().signal;
  const log = input.onLog ?? console.log;

  return withSourceRequestBudget({ remaining: Infinity, deadline: Infinity, signal }, () =>
    withMaintenanceLock(async () => {
      await database.$transaction(async (transaction) => {
        await transaction.ingestionBatch.updateMany({
          where: { status: 'running' },
          data: { status: 'interrupted', finishedAt: startedAt },
        });
        await transaction.ingestionRun.updateMany({
          where: { status: 'running' },
          data: { status: 'interrupted', finishedAt: startedAt },
        });
        await transaction.marketDataState.upsert({
          where: { key: 'global' },
          create: { key: 'global' },
          update: {},
        });
      });
      const runId = ulid();
      const result: IngestionResult = {
        runId,
        targetDate: input.targetDate,
        status: 'running',
        batches: 0,
        succeeded: 0,
        partial: 0,
        failed: 0,
        accepted: 0,
        filtered: 0,
        rejected: 0,
        issues: 0,
      };
      await database.ingestionRun.create({
        data: {
          id: runId,
          targetDate: input.targetDate,
          trigger: input.trigger ?? 'manual',
          scopeSnapshot: {},
          status: 'running',
          startedAt,
        },
      });
      const history = await database.ingestionBatch.findMany({
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        where: { runId: { not: runId } },
        select: {
          dataset: true,
          scope: true,
          period: true,
          rangeStart: true,
          rangeEnd: true,
          sourceStart: true,
          status: true,
        },
      });
      const receipts = new Map<string, typeof history>();
      for (const batch of history) {
        const key = unitKey(batch);
        const saved = receipts.get(key) ?? [];
        saved.push(batch);
        receipts.set(key, saved);
      }
      const byScope = new Map<string, typeof history>();
      for (const batch of history) {
        const key = JSON.stringify([batch.dataset, batch.scope]);
        const saved = byScope.get(key) ?? [];
        saved.push(batch);
        byScope.set(key, saved);
      }
      const attempted = new Set<string>();
      const attempt = async (unit: IngestionUnit) => {
        if (signal.aborted || attempted.has(unitKey(unit))) {
          return;
        }
        attempted.add(unitKey(unit));
        const previous = receipts.get(unitKey(unit))?.[0];
        if (
          !unit.refresh &&
          previous?.status === 'succeeded' &&
          previous.rangeStart &&
          previous.rangeEnd &&
          previous.rangeStart <= unit.startDate &&
          previous.rangeEnd >= unit.endDate
        ) {
          return;
        }
        if (!unit.refresh && (!previous || previous.status === 'succeeded')) {
          const covered = (byScope.get(JSON.stringify([unit.dataset, unit.scope])) ?? []).some(
            (batch) =>
              batch.status === 'succeeded' &&
              (batch.rangeStart ?? batch.sourceStart) &&
              batch.rangeEnd &&
              (batch.rangeStart ?? batch.sourceStart)! <= unit.startDate &&
              batch.rangeEnd >= unit.endDate,
          );
          if (covered) {
            return;
          }
        }
        const batchId = ulid();
        const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
        const fetchedAt = new Date(clock().getTime());
        const source: IngestionInput['source'] = {
          call: async (api, params, fields) => {
            const rows = await input.source.call(api, params, fields);
            fetchedAt.setTime(clock().getTime());
            return rows;
          },
        };
        await database.ingestionBatch.create({
          data: {
            id: batchId,
            runId,
            dataset: unit.dataset,
            scope: unit.scope,
            period: unit.period,
            api: unit.api,
            request: jsonValue({
              scope: unit.scope,
              targetDate: unit.endDate,
              fullHistory: Boolean(unit.fullHistory),
            }),
            rangeStart: unit.period === 'snapshot' ? null : unit.startDate || null,
            rangeEnd: unit.period === 'snapshot' ? null : unit.endDate,
            status: 'running',
            startedAt: clock(),
          },
        });
        result.batches++;
        log(
          `[ingestion] ${unit.dataset}/${unit.scope} ${unit.fullHistory ? 'all' : unit.startDate}..${unit.endDate}`,
        );
        let prepared: PreparedMarketPartition | undefined;
        let selection: string[] | undefined;
        await withImportDiagnostics(diagnostics, async () => {
          try {
            if (unit.dataset === 'etf-selection') {
              const snapshot = await fetchLatestSizes(source, localDate(clock()));
              const catalog = await database.etfBasic.findMany({
                where: { listStatus: 'L', listDate: { lte: snapshot.date } },
                select: { tsCode: true },
              });
              const listed = new Set(catalog.map((row) => row.tsCode));
              selection = snapshot.rows
                .filter(
                  (row) => listed.has(row.tsCode) && row.totalSize !== null && row.totalSize > 0,
                )
                .sort(
                  (left, right) =>
                    right.totalSize! - left.totalSize! || left.tsCode.localeCompare(right.tsCode),
                )
                .slice(0, 100)
                .map((row) => row.tsCode);
              if (selection.length < 100) {
                throw new Error(
                  'A complete size snapshot is required to initialize one hundred ETFs',
                );
              }
              prepared = {
                tables: [],
                status: 'complete',
                gaps: [],
                errors: [],
                observedDates: [],
                checks: {
                  terminalPage: true,
                  sourceFailed: false,
                  invalidRows: 0,
                  emptyResponse: false,
                  pages: 1,
                  sourceRows: snapshot.rows.length,
                },
              };
            } else {
              prepared = await prepareMarketPartition({ source }, unit, fetchedAt);
            }
          } catch (error) {
            diagnostics.issues.push({
              category: 'internal',
              reasonCode: 'preparation_failed',
              message: error instanceof Error ? error.message : String(error),
            });
          }
          const responseComplete = Boolean(
            prepared?.checks.terminalPage && !prepared.checks.sourceFailed,
          );
          if (prepared) {
            for (const message of [
              ...prepared.errors,
              ...(diagnostics.issues.length ? [] : prepared.gaps),
            ]) {
              if (!diagnostics.issues.some((issue) => issue.message === message)) {
                diagnostics.issues.push({
                  category: responseComplete ? 'snapshot' : 'request',
                  reasonCode: responseComplete ? 'batch_not_accepted' : 'incomplete_response',
                  message,
                  payload: undefined,
                });
              }
            }
          }
          if (
            prepared?.checks.emptyResponse &&
            unit.startDate === localDate(startedAt) &&
            ['stock-prices', 'stock-adjustments', 'stock-valuations', 'stock-limits'].includes(
              unit.dataset,
            ) &&
            responseComplete
          ) {
            diagnostics.issues.push({
              category: 'dependency',
              reasonCode: 'current_session_not_published',
              message: 'The source has not returned current-session market observations yet',
            });
          }
          // 只在下载完整后接纳；记录结果与数据共同提交，强杀不会留下半批。
          // Admit complete downloads only; publish receipts and data together to survive forced exits.
          const committed = await withMarketPublication(() =>
            database.$transaction(
              async (transaction) => {
                const accepted =
                  responseComplete &&
                  !signal.aborted &&
                  prepared &&
                  unit.dataset !== 'etf-selection'
                    ? await writeMarketPartition(transaction, prepared, unit, fetchedAt)
                    : {
                        inserted: 0,
                        updated: 0,
                        deleted: 0,
                        rejected: 0,
                        changed: false,
                        errors: [] as string[],
                      };
                for (const message of accepted.errors) {
                  if (!diagnostics.issues.some((issue) => issue.message === message)) {
                    diagnostics.issues.push({
                      category: 'record',
                      reasonCode: 'write_not_accepted',
                      message,
                    });
                  }
                }
                if (
                  selection &&
                  responseComplete &&
                  !diagnostics.issues.length &&
                  !signal.aborted
                ) {
                  await transaction.ingestionSelection.create({
                    data: { assetType: 'etf', codes: selection },
                  });
                }
                const status = signal.aborted
                  ? 'interrupted'
                  : !responseComplete
                    ? 'failed'
                    : diagnostics.issues.length
                      ? 'partial'
                      : 'succeeded';
                const rejected = (prepared?.checks.invalidRows ?? 0) + accepted.rejected;
                const received = prepared?.checks.sourceRows ?? 0;
                const filtered = prepared?.checks.excludedRows ?? 0;
                const acceptedCount =
                  responseComplete && !signal.aborted && (selection || prepared?.tables.length)
                    ? Math.max(0, received - rejected - filtered)
                    : 0;
                await transaction.ingestionBatch.update({
                  where: { id: batchId },
                  data: {
                    status,
                    responseComplete,
                    sourceStart: prepared?.sourceStartDate ?? null,
                    request: jsonValue(diagnostics.requests),
                    receivedCount: received,
                    acceptedCount,
                    filteredCount: filtered,
                    rejectedCount: rejected,
                    finishedAt: clock(),
                  },
                });
                await persistIssues(transaction, runId, batchId, diagnostics.issues);
                if (accepted.changed) {
                  await transaction.marketDataState.update({
                    where: { key: 'global' },
                    data: { revision: { increment: 1 } },
                  });
                }
                return {
                  status,
                  acceptedCount,
                  filtered,
                  rejected,
                  issueCount: diagnostics.issues.length,
                };
              },
              { timeout: 120_000 },
            ),
          );
          switch (committed.status) {
            case 'succeeded':
              result.succeeded++;
              break;
            case 'partial':
              result.partial++;
              break;
            case 'failed':
              result.failed++;
              break;
          }
          result.accepted += committed.acceptedCount;
          result.filtered += committed.filtered;
          result.rejected += committed.rejected;
          result.issues += committed.issueCount;
        });
        for (const issue of diagnostics.issues) {
          log(`[ingestion] ${unit.dataset}/${unit.scope}: ${issue.message}`);
        }
      };
      try {
        for (const unit of referenceUnits(input.targetDate, startedAt)) {
          await attempt(unit);
        }
        if (!signal.aborted) {
          await initializeIndexDownloads();
          if (!(await database.ingestionSelection.findUnique({ where: { assetType: 'etf' } }))) {
            await attempt({
              dataset: 'etf-selection',
              scope: 'all',
              period: 'snapshot',
              startDate: localDate(startedAt),
              endDate: localDate(startedAt),
              api: 'etf_share_size',
              refresh: true,
            });
          }
          const plan = await planIngestion(input.targetDate, startedAt);
          await database.ingestionRun.update({
            where: { id: runId },
            data: {
              scopeSnapshot: jsonValue({
                etfs: await readDownloadCodes('etf'),
                indices: await readDownloadCodes('index'),
                datasets: [...new Set(plan.units.map((unit) => unit.dataset))],
              }),
            },
          });
          for (const blocked of plan.blocked) {
            await persistIssues(database, runId, null, [
              {
                category: 'dependency',
                reasonCode: 'scope_blocked',
                message: `${blocked.dataset}/${blocked.scope}: ${blocked.message}`,
              },
            ]);
            result.issues++;
          }
          for (const unit of plan.units) {
            if (signal.aborted) {
              break;
            }
            await attempt(unit);
          }
        }
        result.status = signal.aborted
          ? 'interrupted'
          : result.issues
            ? 'completed_with_issues'
            : 'completed';
      } catch (error) {
        result.status = 'failed';
        // 数据库故障可能无法继续保存诊断；保留执行中记录供下次恢复。
        // Database failures may prevent persistence; leave running receipts for restart recovery.
        log(`[ingestion] fatal: ${error instanceof Error ? error.message : String(error)}`);
        try {
          await persistIssues(database, runId, null, [
            {
              category: 'internal',
              reasonCode: 'ingestion_failed',
              message: error instanceof Error ? error.message : String(error),
            },
          ]);
          result.issues++;
        } catch {
          throw error;
        }
      }
      await database.ingestionRun.update({
        where: { id: runId },
        data: { status: result.status, finishedAt: clock(), summary: jsonValue(result) },
      });

      try {
        await compactSuccessfulReceipts();
      } catch (error) {
        log(
          `[ingestion] Receipt compaction deferred: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return result;
    }),
  );
}

function unitKey(unit: { dataset: string; scope: string; period: string }): string {
  return JSON.stringify([unit.dataset, unit.scope, unit.period]);
}

/**
 * 只保存非凭证的来源标量与诊断内容，统一 JSON 可序列化边界。
 *
 * Keep serializable source diagnostics and remove credential-shaped fields.
 */
export function jsonValue(value: unknown): import('@prisma/client').Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (key, item) =>
      /token|password|authorization|secret/i.test(key) ? '[redacted]' : item,
    ),
  );
}

async function persistIssues(
  database: Pick<ReturnType<typeof getDatabase>, 'ingestionIssue'>,
  runId: string,
  batchId: string | null,
  issues: ImportIssue[],
): Promise<void> {
  if (!issues.length) {
    return;
  }
  await database.ingestionIssue.createMany({
    data: issues.map((issue) => ({
      id: ulid(),
      runId,
      batchId,
      category: issue.category,
      reasonCode: issue.reasonCode,
      message: issue.message,
      ...(issue.businessKey != null ? { businessKey: jsonValue(issue.businessKey) } : {}),
      ...(issue.field ? { field: issue.field } : {}),
      ...(issue.payload != null ? { payload: jsonValue(issue.payload) } : {}),
    })),
  });
}
