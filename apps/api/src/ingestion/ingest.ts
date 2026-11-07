import { ulid } from 'ulid';
import { statementReceiptMatchesBatch } from '#market/fundamentals/statement-requests.js';
import { MarketSourceRangeLimitError } from '#market/errors.js';
import {
  DIVIDEND_DATE_FIELDS,
  dividendReceiptHasCompleteFields,
  dividendReceiptMatchesRequests,
} from '#market/fundamentals/dividend-identity.js';
import { financialStockCodes } from '#market/fundamentals/scope.js';
import { IngestionError } from './errors.js';
import { getDatabase } from '#infra/database/prisma.js';
import { withMaintenanceLock, withMarketPublication } from '#infra/coordination/market-access.js';
import { withSourceRequestBudget } from '#market/providers/source-fetch.js';
import { isObservationDate, localDate } from '#market/synchronization/date.js';
import { prepareMarketPartition, writeMarketPartition } from '#market/synchronization/prepare.js';
import {
  withImportDiagnostics,
  isImportError,
  type ImportDiagnostics,
  type ImportIssue,
} from '#market/synchronization/diagnostics.js';
import { mergeEtfSelection, prepareHistoricalEtfSelection } from '#market/downloads/select-etfs.js';
import { initializeIndexDownloads } from '#market/downloads/lists.js';
import type { PreparedMarketPartition } from '#market/synchronization/partition.js';
import { compactSuccessfulReceipts } from './receipts.js';
import { ensureRunIssueResolutions } from './resolutions.js';
import { planEtfSelections, planIngestion, referenceUnits } from './plan.js';
import { latestAttempts, openIngestionRun, summarizeIngestionRun, unitKey } from './runs.js';
import { parseRunPlan, type IngestionRunPlan } from './schema.js';
import type { IngestionInput, IngestionResult, IngestionUnit } from './schema.js';
import { STATEMENT_STRATEGY, planStatementUnits } from './statement-plan.js';
import { replaceRangeUnit, splitRangeUnit, uncoveredRangeUnits } from './ranges.js';

/**
 * 固定目标、整批下载和短事务接纳；成功批次即恢复依据。
 *
 * Freeze the target, download complete batches and publish atomically; receipts drive recovery.
 */
export async function ingest(input: IngestionInput): Promise<IngestionResult> {
  return withMaintenanceLock(() => collect(input));
}

/** 绑定副本后只执行批次事务。 / Collect into a bound replica using batch transactions only. */
export async function collectInReplica(
  input: IngestionInput,
  runId: string,
  upgradeStatements = false,
): Promise<IngestionResult> {
  return collect(input, runId, upgradeStatements);
}

async function collect(
  input: IngestionInput,
  replicaRunId?: string,
  upgradeStatements = false,
): Promise<IngestionResult> {
  if (!isObservationDate(input.targetDate)) {
    throw new IngestionError('invalid_target_date');
  }
  const database = getDatabase();
  const clock = input.clock ?? (() => new Date());
  const invokedAt = clock();
  const signal = input.signal ?? new AbortController().signal;
  const log = input.onLog ?? console.log;

  return withSourceRequestBudget({ remaining: Infinity, deadline: Infinity, signal }, async () => {
    const run = replicaRunId
      ? await database.$transaction(async (transaction) => {
          await transaction.ingestionBatch.updateMany({
            where: { runId: replicaRunId, status: 'running' },
            data: { status: 'interrupted', finishedAt: invokedAt },
          });
          return transaction.ingestionRun.update({
            where: { id: replicaRunId },
            data: { status: 'running', finishedAt: null },
          });
        })
      : await openIngestionRun(input.targetDate, input.trigger ?? 'manual', invokedAt);
    const publish = replicaRunId
      ? <Result>(work: () => Promise<Result>) => work()
      : withMarketPublication;
    const runId = run.id;
    const startedAt = run.startedAt;
    const snapshot = run.scopeSnapshot;
    let runPlan: IngestionRunPlan =
      snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) && 'version' in snapshot
        ? parseRunPlan(snapshot)
        : {
            version: 2,
            referenceUnits: referenceUnits(input.targetDate, startedAt),
          };
    const savePlan = async (next: IngestionRunPlan) => {
      await database.ingestionRun.update({
        where: { id: runId },
        data: { scopeSnapshot: jsonValue(next) },
      });
      runPlan = next;
    };
    await savePlan(runPlan);
    log(
      `[ingestion] ${run.startedAt.getTime() === invokedAt.getTime() ? 'Running' : 'Resuming'} run ${runId} to ${input.targetDate}`,
    );
    const required = new Set<string>();
    let standaloneIssues = 0;
    let fatal = false;
    let dependenciesChanged = false;
    const history = await database.ingestionBatch.findMany({
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: {
        runId: true,
        dataset: true,
        scope: true,
        period: true,
        rangeStart: true,
        rangeEnd: true,
        sourceStart: true,
        status: true,
        request: true,
        responseComplete: true,
        rejectedCount: true,
        startedAt: true,
      },
    });
    const currentAttempts = latestAttempts(history.filter((batch) => batch.runId === runId));
    const receipts = new Map<string, typeof history>();
    for (const batch of history.filter((batch) => batch.runId !== runId)) {
      const key = unitKey(batch);
      const saved = receipts.get(key) ?? [];
      saved.push(batch);
      receipts.set(key, saved);
    }
    const byScope = new Map<string, typeof history>();
    for (const batch of history.filter((batch) => batch.runId !== runId)) {
      const key = JSON.stringify([batch.dataset, batch.scope]);
      const saved = byScope.get(key) ?? [];
      saved.push(batch);
      byScope.set(key, saved);
    }
    const attempted = new Set<string>();
    const splitUnits = new Map<string, IngestionUnit[]>();
    const reusable = (batch: (typeof history)[number]) => {
      if (batch.dataset === 'financial-statements') {
        return (
          batch.status === 'succeeded' &&
          batch.responseComplete &&
          batch.rejectedCount === 0 &&
          statementReceiptMatchesBatch(batch, batch.runId === runId)
        );
      }
      if (batch.status !== 'succeeded' || batch.dataset !== 'dividends') {
        return batch.status === 'succeeded';
      }
      if (!batch.responseComplete || batch.rejectedCount !== 0) {
        return false;
      }
      const dateField = DIVIDEND_DATE_FIELDS.find((field) => field === batch.scope);

      return dateField
        ? batch.rangeStart === batch.period &&
            (batch.rangeEnd === batch.period ||
              (batch.runId === runId && batch.rangeEnd === null)) &&
            dividendReceiptMatchesRequests(batch.request, [{ [dateField]: batch.period }])
        : dividendReceiptHasCompleteFields(batch.request);
    };
    const completed = new Set(
      [...currentAttempts].filter(([, batch]) => reusable(batch)).map(([key]) => key),
    );
    const attempt = async (unit: IngestionUnit): Promise<boolean> => {
      required.add(unitKey(unit));
      if (signal.aborted) {
        return false;
      }
      if (attempted.has(unitKey(unit))) {
        return completed.has(unitKey(unit));
      }
      attempted.add(unitKey(unit));
      const current = currentAttempts.get(unitKey(unit));
      if (current && reusable(current)) {
        return true;
      }

      const previous = receipts.get(unitKey(unit))?.[0];
      if (
        !current &&
        !unit.adaptiveRange &&
        !unit.refresh &&
        previous?.status === 'succeeded' &&
        previous.rangeStart &&
        previous.rangeEnd &&
        previous.rangeStart <= unit.startDate &&
        previous.rangeEnd >= unit.endDate
      ) {
        completed.add(unitKey(unit));
        return true;
      }
      if (
        !current &&
        !unit.adaptiveRange &&
        !unit.refresh &&
        (!previous || previous.status === 'succeeded')
      ) {
        const covered = (byScope.get(JSON.stringify([unit.dataset, unit.scope])) ?? []).some(
          (batch) =>
            batch.status === 'succeeded' &&
            (batch.rangeStart ?? batch.sourceStart) &&
            batch.rangeEnd &&
            (batch.rangeStart ?? batch.sourceStart)! <= unit.startDate &&
            batch.rangeEnd >= unit.endDate,
        );
        if (covered) {
          completed.add(unitKey(unit));
          return true;
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
      const logScope = [unit.dataset, unit.scope, unit.announcementField].filter(Boolean).join('/');
      log(`[ingestion] ${logScope} ${unit.fullHistory ? 'all' : unit.startDate}..${unit.endDate}`);
      let prepared: PreparedMarketPartition | undefined;
      let selection: string[] | undefined;
      let succeeded = false;
      await withImportDiagnostics(diagnostics, async () => {
        try {
          if (unit.dataset === 'etf-selection') {
            const snapshot = await prepareHistoricalEtfSelection({
              source,
              date: unit.endDate,
              exchanges: unit.exchanges,
            });
            selection = snapshot.selectedCodes;
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
                emptyResponse: snapshot.receivedCount === 0,
                pages: snapshot.pages,
                sourceRows: snapshot.receivedCount,
                excludedRows: snapshot.receivedCount - selection.length,
              },
            };
          } else {
            prepared = await prepareMarketPartition({ source }, unit, fetchedAt);
          }
        } catch (error) {
          if (error instanceof MarketSourceRangeLimitError && unit.adaptiveRange) {
            const children = splitRangeUnit(unit);
            const next = replaceRangeUnit(runPlan, unit, children);
            await database.$transaction(async (transaction) => {
              await transaction.ingestionBatch.update({
                where: { id: batchId },
                data: {
                  status: 'split',
                  responseComplete: false,
                  receivedCount: error.receivedCount,
                  request: jsonValue(diagnostics.requests),
                  finishedAt: clock(),
                },
              });
              await transaction.ingestionRun.update({
                where: { id: runId },
                data: { scopeSnapshot: jsonValue(next) },
              });
            });
            runPlan = next;
            required.delete(unitKey(unit));
            splitUnits.set(unitKey(unit), children);
            log(
              `[ingestion] ${logScope}: response limit reached; split into ${children.length} ranges`,
            );

            return;
          }
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
            ...(diagnostics.issues.some(isImportError) ? [] : prepared.gaps),
          ]) {
            if (
              !diagnostics.issues.some((issue) => isImportError(issue) && issue.message === message)
            ) {
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
        const committed = await publish(() =>
          database.$transaction(
            async (transaction) => {
              const accepted =
                responseComplete && !signal.aborted && prepared && unit.dataset !== 'etf-selection'
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
                if (
                  !diagnostics.issues.some(
                    (issue) => isImportError(issue) && issue.message === message,
                  )
                ) {
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
                !diagnostics.issues.some(isImportError) &&
                !signal.aborted
              ) {
                await mergeEtfSelection(transaction, selection);
              }
              const status = signal.aborted
                ? 'interrupted'
                : !responseComplete
                  ? 'failed'
                  : diagnostics.issues.some(isImportError)
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
                  ...(prepared?.hasDeferredRecords ? { rangeEnd: null } : {}),
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
                issueCount: diagnostics.issues.filter(isImportError).length,
              };
            },
            { timeout: 120_000 },
          ),
        );
        succeeded = committed.status === 'succeeded';
        if (succeeded) {
          completed.add(unitKey(unit));
          dependenciesChanged ||= [
            'calendar',
            'stock-master',
            'etf-master',
            'etf-selection',
          ].includes(unit.dataset);
        }
      });
      for (const issue of diagnostics.issues) {
        log(
          `[ingestion] ${unit.dataset}/${unit.scope} [${issue.severity ?? 'error'}]: ${issue.message}`,
        );
      }

      return succeeded;
    };
    const executeUnit = async (unit: IngestionUnit): Promise<boolean> => {
      const key = unitKey(unit);
      const current = currentAttempts.get(key);
      const missing = current && reusable(current) ? [unit] : uncoveredRangeUnits(unit, history);
      if (missing.length !== 1 || unitKey(missing[0]) !== key) {
        await savePlan(replaceRangeUnit(runPlan, unit, missing));
        required.delete(key);
        let succeeded = true;
        for (const child of missing) {
          succeeded = (await executeUnit(child)) && succeeded;
        }

        return succeeded;
      }

      const succeeded = await attempt(unit);
      const children = splitUnits.get(key);
      if (!children) {
        return succeeded;
      }
      let childrenSucceeded = true;
      for (const child of children) {
        childrenSucceeded = (await executeUnit(child)) && childrenSucceeded;
      }

      return childrenSucceeded;
    };
    try {
      let stockCatalogReady = true;
      for (const unit of runPlan.referenceUnits) {
        const succeeded = await executeUnit(unit);
        if (unit.dataset === 'stock-master' && !succeeded) {
          stockCatalogReady = false;
        }
      }
      if (!signal.aborted) {
        await initializeIndexDownloads(publish);
        if (!runPlan.selectionUnits || dependenciesChanged) {
          await savePlan({
            ...runPlan,
            selectionUnits: await planEtfSelections(input.targetDate, startedAt),
          });
        }
        for (const unit of runPlan.selectionUnits!) {
          if (signal.aborted) {
            break;
          }
          await executeUnit(unit);
        }
        const saved = runPlan.plan;
        const plan =
          upgradeStatements && saved && !saved.statementStrategy && stockCatalogReady
            ? await upgradeStatementPlan(saved, runId, input.targetDate, invokedAt)
            : ((dependenciesChanged || saved?.blocked.length ? undefined : saved) ??
              (await planIngestion(input.targetDate, startedAt, runId)));
        await savePlan({ ...runPlan, plan });
        for (const unit of runPlan.plan!.units) {
          required.add(unitKey(unit));
        }
        for (const blocked of plan.blocked) {
          await persistIssues(database, runId, null, [
            {
              category: 'dependency',
              reasonCode: 'scope_blocked',
              message: `${blocked.dataset}/${blocked.scope}: ${blocked.message}`,
            },
          ]);
          standaloneIssues++;
        }
        for (const unit of runPlan.plan!.units) {
          if (
            !stockCatalogReady &&
            ['financial-statements', 'financial-indicators', 'dividends'].includes(unit.dataset)
          ) {
            continue;
          }
          if (signal.aborted) {
            break;
          }
          await executeUnit(unit);
        }
      }
    } catch (error) {
      fatal = true;
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
        standaloneIssues++;
      } catch {
        throw error;
      }
    }
    const result = await summarizeIngestionRun(runId, input.targetDate, required);
    result.issues += standaloneIssues;
    result.status = fatal
      ? 'failed'
      : signal.aborted
        ? 'interrupted'
        : result.issues || result.partial || result.failed
          ? 'completed_with_issues'
          : 'completed';
    await database.$transaction(
      async (transaction) => {
        await transaction.ingestionRun.update({
          where: { id: runId },
          data: { status: result.status, finishedAt: clock(), summary: jsonValue(result) },
        });
        await ensureRunIssueResolutions(transaction, runId);
      },
      { timeout: 120_000 },
    );

    try {
      if (!replicaRunId) {
        await compactSuccessfulReceipts();
      }
    } catch (error) {
      log(
        `[ingestion] Receipt compaction deferred: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  });
}

/**
 * 只升级旧计划中尚未完成的财报。保留有诊断的单元，以便继续核验或按原口径重试。
 *
 * Upgrade pending statement work only. Keep diagnosed units for review or retry with their original filter.
 */
async function upgradeStatementPlan(
  plan: NonNullable<IngestionRunPlan['plan']>,
  runId: string,
  targetDate: string,
  invokedAt: Date,
): Promise<NonNullable<IngestionRunPlan['plan']>> {
  const attempts = await getDatabase().ingestionBatch.findMany({
    where: {
      runId,
      dataset: 'financial-statements',
      OR: [{ status: 'succeeded' }, { issues: { some: {} } }],
    },
    select: { dataset: true, scope: true, period: true },
  });
  const retained = new Set(attempts.map(unitKey));
  const codes = plan.statementCodes ?? [...(await financialStockCodes(targetDate))].sort();
  const planned = await planStatementUnits(codes, targetDate, invokedAt);
  const units = new Map(
    plan.units
      .filter((unit) => unit.dataset !== 'financial-statements' || retained.has(unitKey(unit)))
      .map((unit) => [unitKey(unit), unit]),
  );
  for (const unit of planned) {
    if (!units.has(unitKey(unit))) {
      units.set(unitKey(unit), unit);
    }
  }

  return {
    ...plan,
    units: [...units.values()],
    statementCodes: codes,
    statementStrategy: STATEMENT_STRATEGY,
  };
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
      severity: issue.severity ?? 'error',
      reasonCode: issue.reasonCode,
      message: issue.message,
      ...(issue.businessKey != null ? { businessKey: jsonValue(issue.businessKey) } : {}),
      ...(issue.field ? { field: issue.field } : {}),
      ...(issue.payload != null ? { payload: jsonValue(issue.payload) } : {}),
    })),
  });
}
