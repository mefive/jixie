import { expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as marketContext from '#market/synchronization/diagnostic-context.js';
import { withSyncDatabase } from '../../tests/sync-database.js';
import type { Prisma } from '#infra/database/prisma.js';
import { DIVIDEND_SOURCE_FIELDS } from '#market/fundamentals/dividend-identity.js';
import { exportIngestionIssues } from './issue-export.js';
import type { IngestionUnit } from './schema.js';

const runId = 'export-run';
const code = { commit: 'reviewed-test-commit', sourceDirty: false };
const capture = new Date('2026-11-04T00:00:00Z');
const warningBars = [
  { ts_code: '000003.SZ', trade_date: '19911107', open: 15.5, high: 18.3, low: 17.5, close: 17.7 },
  {
    ts_code: '000003.SZ',
    trade_date: '19920131',
    open: 20.15,
    high: 20.85,
    low: 20.81,
    close: 20.75,
  },
  {
    ts_code: '000015.SZ',
    trade_date: '19921016',
    open: 17.35,
    high: 17.7,
    low: 17.35,
    close: 17.1,
  },
  { ts_code: '000013.SZ', trade_date: '19921027', open: 18, high: 18.3, low: 17.1, close: 17 },
  { ts_code: '000003.SZ', trade_date: '19921027', open: 29.55, high: 29.95, low: 28.8, close: 28 },
  { ts_code: '000016.SZ', trade_date: '19930809', open: 14, high: 15, low: 14.15, close: 15 },
  {
    ts_code: '000004.SZ',
    trade_date: '19930809',
    open: 15.75,
    high: 16.75,
    low: 15.8,
    close: 16.7,
  },
  { ts_code: '000013.SZ', trade_date: '19930809', open: 11.85, high: 12.7, low: 12, close: 12.65 },
];
const cashProposal = {
  ts_code: '300587.SZ',
  end_date: '20181231',
  ann_date: '20190423',
  ex_date: null,
  div_proc: '预案',
  cash_div: 0,
  cash_div_tax: 0.15,
  base_date: '20190423',
  base_share: 10689,
  stk_div: 0.7,
  stk_co_rate: 0.7,
};
const stoppedDistribution = {
  ts_code: '603050.SH',
  end_date: '20161231',
  ann_date: '20170613',
  ex_date: null,
  div_proc: '停止实施',
  cash_div: 0,
  cash_div_tax: 0.25,
  base_date: '20170414',
  base_share: 13334,
  stk_div: 0.2,
  stk_co_rate: 0.2,
};

async function seedDiagnostics(database: Prisma) {
  const units: IngestionUnit[] = [...new Set(warningBars.map((row) => row.trade_date))].map(
    (date) => ({
      dataset: 'stock-prices',
      scope: 'SSE,SZSE',
      period: date,
      api: 'daily',
      refresh: false,
      startDate: date,
      endDate: date,
    }),
  );
  for (const security of ['300587.SZ', '603050.SH']) {
    units.push({
      dataset: 'dividends',
      scope: security,
      period: 'all',
      api: 'dividend',
      refresh: true,
      startDate: '',
      endDate: '20181231',
      fullHistory: true,
    });
  }
  await database.ingestionRun.create({
    data: {
      id: runId,
      trigger: 'manual',
      targetDate: '20181231',
      status: 'completed_with_issues',
      startedAt: capture,
      finishedAt: capture,
      scopeSnapshot: {
        version: 2,
        referenceUnits: [],
        selectionUnits: [],
        plan: { units: JSON.parse(JSON.stringify(units)), blocked: [] },
      },
      summary: { issues: 3, warnings: 8, partial: 2, rejected: 6 },
    },
  });
  await database.marketDataState.create({ data: { key: 'global', revision: 42 } });
  await database.user.create({
    data: { id: 'private-user', email: 'never-export@example.test', name: 'private-login-data' },
  });
  for (const unit of units) {
    const id = `${unit.dataset}-${unit.scope}-${unit.period}`;
    await database.ingestionBatch.create({
      data: {
        id,
        runId,
        dataset: unit.dataset,
        scope: unit.scope,
        period: unit.period,
        api: unit.api,
        request: [
          {
            api: unit.api,
            params: { token: 'provider-secret' },
            fields:
              unit.dataset === 'dividends'
                ? DIVIDEND_SOURCE_FIELDS
                : 'ts_code,trade_date,open,high,low,close',
          },
        ],
        rangeStart: unit.startDate || null,
        rangeEnd: unit.endDate,
        status: unit.dataset === 'dividends' ? 'partial' : 'succeeded',
        responseComplete: true,
        rejectedCount: unit.scope === '300587.SZ' ? 4 : unit.scope === '603050.SH' ? 2 : 0,
        startedAt: capture,
        finishedAt: capture,
      },
    });
  }
  for (const [index, row] of warningBars.entries()) {
    await database.daily.create({
      data: {
        tsCode: row.ts_code,
        tradeDate: row.trade_date,
        open: index === 0 ? 16 : row.open,
        high: row.high,
        low: row.low,
        close: row.close,
      },
    });
    await database.ingestionIssue.create({
      data: {
        id: `warning-${index}`,
        runId,
        batchId: `stock-prices-SSE,SZSE-${row.trade_date}`,
        category: 'record',
        severity: 'warning',
        reasonCode: 'ohlc_range_inconsistent',
        message: 'Inconsistent OHLC price range',
        businessKey: { tsCode: row.ts_code, tradeDate: row.trade_date },
        field: 'ohlc',
        payload: row,
      },
    });
  }
  await database.dividend.create({
    data: {
      id: 'known-current-dividend',
      tsCode: '300587.SZ',
      endDate: '20181231',
      annDate: '20190601',
      divProc: '实施',
      cashDivTax: 0.13,
      observedAt: capture,
      distributionKind: 'mixed',
    },
  });
  for (const [index, stage] of ['预案', '股东大会通过'].entries()) {
    await database.ingestionIssue.create({
      data: {
        id: `cash-conflict-${index}`,
        runId,
        batchId: 'dividends-300587.SZ-all',
        category: 'record',
        severity: 'error',
        reasonCode: 'conflicting_business_key',
        message: 'Conflicting business key',
        payload: [
          { ...cashProposal, div_proc: stage },
          { ...cashProposal, div_proc: stage, cash_div_tax: 0.13 },
        ],
      },
    });
  }
  await database.ingestionIssue.create({
    data: {
      id: 'null-zero-conflict',
      runId,
      batchId: 'dividends-603050.SH-all',
      category: 'record',
      severity: 'error',
      reasonCode: 'conflicting_business_key',
      message: 'Conflicting business key',
      payload: [stoppedDistribution, { ...stoppedDistribution, cash_div: null }],
    },
  });
  for (const [id, dataset, scope, period] of [
    ['old-dividend', 'dividends', '300587.SZ', 'all'],
    ['old-catalog', 'financial-periods', 'all', 'snapshot'],
  ]) {
    await database.ingestionBatch.create({
      data: {
        id,
        runId,
        dataset,
        scope,
        period,
        api: 'old',
        request: {},
        status: 'failed',
        startedAt: new Date('2026-11-03T00:00:00Z'),
      },
    });
    await database.ingestionIssue.create({
      data: {
        id: `${id}-issue`,
        runId,
        batchId: id,
        category: 'request',
        reasonCode: 'old-error',
        message: 'Historical error',
      },
    });
  }
}

it(
  'exports current cash conflicts and accepted warnings with business records and repair fields, keeping old errors historical',
  async () =>
    withSyncDatabase(async (database) => {
      await seedDiagnostics(database);
      const before = await Promise.all([
        database.ingestionRun.findMany(),
        database.ingestionBatch.findMany(),
        database.ingestionIssue.findMany(),
        database.dividend.findMany(),
        database.daily.findMany(),
        database.marketDataState.findMany(),
        database.user.findMany(),
      ]);
      const bundle = await exportIngestionIssues({ runId, code });
      expect(bundle.counts.currentDiagnostics).toEqual({ error: 3, warning: 8 });
      expect(bundle.counts.historicalDiagnostics).toEqual({ error: 2, warning: 0 });
      expect(bundle.counts.effectiveBatchesInThisRun).toMatchObject({
        partial: 2,
        failed: 0,
        rejectedRecords: 6,
      });
      expect(bundle.items).toHaveLength(11);
      expect(bundle.historicalIssues.map((row) => row.classification).sort()).toEqual([
        'obsolete_unit',
        'superseded_attempt',
      ]);
      const cash = bundle.items.find((item) => item.issue.id === 'cash-conflict-0')!;
      expect(cash.issue.payload).toEqual([cashProposal, { ...cashProposal, cash_div_tax: 0.13 }]);
      expect(cash.batch).toMatchObject({ status: 'partial', responseComplete: true });
      expect(cash.context).toMatchObject({
        affectedFields: ['cashDivTax'],
        records: [
          {
            key: { tsCode: '300587.SZ', endDate: '20181231', divProc: '实施' },
            values: { cashDivTax: 0.13 },
          },
        ],
        allowedOperations: ['accept', 'insert'],
      });
      const missing = bundle.items.find((item) => item.issue.id === 'null-zero-conflict')!;
      expect(missing.issue.payload).toEqual([
        stoppedDistribution,
        { ...stoppedDistribution, cash_div: null },
      ]);
      expect(missing.context).toMatchObject({
        contextComplete: true,
        records: [],
        affectedFields: ['cashDiv'],
      });
      const bar = bundle.items.find((item) => item.issue.id === 'warning-0')!;
      expect(bar.issue.payload).toMatchObject({ open: 15.5 });
      expect(bar.context).toMatchObject({
        affectedFields: ['open', 'high', 'low', 'close'],
        records: [
          {
            key: { tsCode: '000003.SZ', tradeDate: '19911107' },
            values: { open: 16 },
            expectedVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        ],
        allowedOperations: ['accept', 'update', 'delete'],
      });
      expect(bundle).not.toHaveProperty('tableSchemas');
      expect(bundle).not.toHaveProperty('version');
      expect(bundle.manifest.marketRevision).toBe(42);
      expect(JSON.stringify(bundle.repairContract)).toContain('Pre-tax cash dividend');
      expect(JSON.stringify(bundle)).not.toMatch(
        /CREATE TABLE|known-current-dividend|foreignKeys|schemaFingerprint/,
      );
      expect(JSON.stringify(bundle)).not.toMatch(
        /provider-secret|never-export@example.test|private-login-data/,
      );
      expect(
        await Promise.all([
          database.ingestionRun.findMany(),
          database.ingestionBatch.findMany(),
          database.ingestionIssue.findMany(),
          database.dividend.findMany(),
          database.daily.findMany(),
          database.marketDataState.findMany(),
          database.user.findMany(),
        ]),
      ).toEqual(before);
    }),
  60_000,
);

it(
  'exports one current issue while retaining full-run counts and rejects historical or unknown issue IDs',
  async () =>
    withSyncDatabase(async (database) => {
      await seedDiagnostics(database);
      const bundle = await exportIngestionIssues({ runId, code, issueId: 'null-zero-conflict' });
      expect(bundle.items.map((item) => item.issue.id)).toEqual(['null-zero-conflict']);
      expect(bundle.counts.selectedDiagnostics).toEqual({ error: 1, warning: 0 });
      expect(bundle.counts.currentDiagnostics).toEqual({ error: 3, warning: 8 });
      expect(JSON.stringify(bundle.repairContract)).not.toContain('stock-prices');
      for (const issueId of ['old-dividend-issue', 'missing', 'old-catalog-issue']) {
        await expect(exportIngestionIssues({ runId, code, issueId })).rejects.toMatchObject({
          reason: 'export_issue_not_current',
        });
      }
      await expect(exportIngestionIssues({ runId: 'missing', code })).rejects.toMatchObject({
        reason: 'export_run_not_found',
      });
      expect(await database.daily.count()).toBe(8);
    }),
  60_000,
);

it(
  'keeps standalone issues unknown instead of guessing they were resolved',
  async () =>
    withSyncDatabase(async (database) => {
      await seedDiagnostics(database);
      await database.ingestionIssue.create({
        data: {
          id: 'run-level',
          runId,
          category: 'dependency',
          reasonCode: 'scope_blocked',
          message: 'Requires judgment',
        },
      });
      const bundle = await exportIngestionIssues({ runId, code, issueId: 'run-level' });
      expect(bundle.items[0]).toMatchObject({
        batch: null,
        classification: 'run_level_unknown',
        context: { contextComplete: false },
      });
      expect(bundle.counts.unknownOrIncompleteDiagnostics).toEqual({ error: 1, warning: 0 });
    }),
  60_000,
);

it(
  'does not claim an old-field dividend success receipt is complete and reports unsupported plans honestly',
  async () =>
    withSyncDatabase(async (database) => {
      await seedDiagnostics(database);
      await database.ingestionBatch.update({
        where: { id: 'dividends-300587.SZ-all' },
        data: {
          status: 'succeeded',
          request: [{ api: 'dividend', params: {}, fields: 'ts_code,end_date,cash_div_tax' }],
        },
      });
      const first = await exportIngestionIssues({ runId, code });
      expect(first.items.find((item) => item.issue.id === 'cash-conflict-0')!.classification).toBe(
        'incomplete_dividend_receipt',
      );
      expect(first.counts.effectiveBatchesInThisRun).toMatchObject({
        incompleteSuccessReceipts: 1,
      });
      await database.ingestionRun.update({
        where: { id: runId },
        data: { scopeSnapshot: {}, status: 'running' },
      });
      const unknown = await exportIngestionIssues({ runId, code });
      expect(unknown.run.summaryMayBeStale).toBe(true);
      expect(
        unknown.items.find((item) => item.issue.id === 'cash-conflict-0')!.classification,
      ).toBe('unknown_plan');
      expect(unknown.selection.planComplete).toBe(false);
      expect(unknown.limitations).toContain('saved_plan_is_incomplete_or_unsupported');
    }),
  60_000,
);

it(
  'uses a query-only transaction that refuses accidental domain writes and restores the caller connection',
  async () =>
    withSyncDatabase(async (database) => {
      await seedDiagnostics(database);
      const original = marketContext.loadMarketDiagnosticContext;
      const spy = vi.spyOn(marketContext, 'loadMarketDiagnosticContext');
      spy.mockImplementationOnce(async (transaction, input) => {
        await transaction.marketDataState.update({
          where: { key: 'global' },
          data: { revision: 99 },
        });
        return original(transaction, input);
      });
      try {
        await expect(exportIngestionIssues({ runId, code })).rejects.toThrow();
      } finally {
        spy.mockRestore();
      }
      expect(
        await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } }),
      ).toMatchObject({ revision: 42 });
      await database.marketDataState.update({ where: { key: 'global' }, data: { revision: 43 } });
      expect(
        await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } }),
      ).toMatchObject({ revision: 43 });
    }),
  60_000,
);

it(
  'runs the actual CLI against an isolated database and returns success even with data errors',
  async () =>
    withSyncDatabase(async (database, directory) => {
      await seedDiagnostics(database);
      const output = join(directory, 'diagnostics.json');
      const cwd = new URL('../../', import.meta.url);
      const result = await promisify(execFile)(
        process.execPath,
        [
          '--conditions=development',
          '--import',
          'tsx',
          'src/ingestion/cli/data.ts',
          'issues',
          'export',
          runId,
          '--out',
          output,
        ],
        {
          cwd,
          env: {
            ...process.env,
            DATABASE_URL: `file:${join(directory, 'test.db')}`,
            TUSHARE_TOKEN: '',
          },
          timeout: 30_000,
        },
      );
      const summary = JSON.parse(result.stdout);
      expect(summary).toMatchObject({
        output,
        counts: { currentDiagnostics: { error: 3, warning: 8 } },
      });
      const bundle = JSON.parse(await readFile(output, 'utf8'));
      expect(bundle.run.id).toBe(runId);
      expect(bundle.items).toHaveLength(11);
      expect(await database.ingestionRun.findUniqueOrThrow({ where: { id: runId } })).toMatchObject(
        { status: 'completed_with_issues' },
      );
    }),
  60_000,
);
