import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import type { Prisma } from '#infra/database/prisma.js';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { exportIngestionIssues } from './issue-export.js';
import { issueRepairPlanSchema, type IssueRepairPlan } from './repair-schema.js';
import { repairIngestionIssues } from './repair.js';

const code = { commit: 'test', sourceDirty: false };
const runId = 'repair-run';
const key = { tsCode: '000003.SZ', tradeDate: '19920131' };
const reportKey = {
  tsCode: key.tsCode,
  endDate: '20181231',
  annDate: '20190423',
  exDate: null,
  divProc: '预案',
  distributionKind: 'mixed',
} as const;
const evidence = ['https://example.test/source-evidence'];
const quote = { open: 20.15, high: 20.85, low: 20.81, close: 20.75 };

async function seed(database: Prisma) {
  const stockUnit = {
    dataset: 'stock-prices',
    scope: 'SSE,SZSE',
    period: key.tradeDate,
    api: 'daily',
    refresh: false,
    startDate: key.tradeDate,
    endDate: key.tradeDate,
  };
  const dividendUnit = {
    dataset: 'dividends',
    scope: key.tsCode,
    period: 'all',
    api: 'dividend',
    refresh: true,
    startDate: '19900101',
    endDate: '20181231',
  };
  await database.ingestionRun.create({
    data: {
      id: runId,
      trigger: 'manual',
      targetDate: '20181231',
      status: 'completed_with_issues',
      finishedAt: new Date('2026-11-01'),
      scopeSnapshot: {
        version: 2,
        referenceUnits: [],
        selectionUnits: [],
        plan: { units: [stockUnit, dividendUnit], blocked: [] },
      },
    },
  });
  for (const [id, unit, status] of [
    ['stock', stockUnit, 'succeeded'],
    ['dividend', dividendUnit, 'partial'],
  ] as const) {
    await database.ingestionBatch.create({
      data: {
        id,
        runId,
        dataset: unit.dataset,
        scope: unit.scope,
        period: unit.period,
        api: unit.api,
        status,
        request: [],
        responseComplete: true,
        rangeStart: unit.startDate,
        rangeEnd: unit.endDate,
      },
    });
  }
  await database.stockBasic.create({
    data: { tsCode: key.tsCode, symbol: '000003', name: 'Fixture', listStatus: 'D' },
  });
  await database.daily.create({ data: { ...key, ...quote } });
  await database.ingestionIssue.createMany({
    data: [
      {
        id: 'price-warning',
        runId,
        batchId: 'stock',
        category: 'record',
        severity: 'warning',
        reasonCode: 'ohlc_range_inconsistent',
        message: 'Warning',
        field: 'ohlc',
        businessKey: key,
        payload: { ts_code: key.tsCode, trade_date: key.tradeDate, ...quote },
      },
      {
        id: 'dividend-error',
        runId,
        batchId: 'dividend',
        category: 'record',
        reasonCode: 'conflicting_business_key',
        message: 'Conflict',
        payload: [
          {
            ts_code: key.tsCode,
            end_date: '20181231',
            ann_date: '20190423',
            div_proc: '预案',
            cash_div_tax: 0.13,
          },
          {
            ts_code: key.tsCode,
            end_date: '20181231',
            ann_date: '20190423',
            div_proc: '预案',
            cash_div_tax: 0.15,
          },
        ],
      },
    ],
  });
  await database.marketDataState.create({ data: { key: 'global', revision: 40 } });
}

async function template(issueId: string, op: string) {
  const bundle = await exportIngestionIssues({ runId, issueId, code });
  const templates = bundle.items[0].context.templates as Array<Record<string, unknown>>;
  const selected = templates.find((candidate) => candidate.op === op);
  expect(selected).toBeDefined();

  return { ...selected, reason: 'Verified provider evidence', evidence };
}

async function preview(plan: IssueRepairPlan) {
  return repairIngestionIssues(plan, {
    backup: async () => {
      throw new Error('Preview must not back up or write');
    },
  });
}

it(
  'uses the real CLI to preview and atomically apply a business patch, then replays the receipt',
  async () =>
    withSyncDatabase(async (database, directory) => {
      await seed(database);
      const plan = issueRepairPlanSchema.parse({
        runId,
        actions: [
          { ...(await template('price-warning', 'update')), values: { low: 20.15 } },
          { ...(await template('dividend-error', 'accept')) },
        ],
      });
      const filename = join(directory, 'repair.json');
      await writeFile(filename, JSON.stringify(plan));
      const invoke = async (...args: string[]) => {
        const { stdout } = await promisify(execFile)(
          process.execPath,
          [
            '--conditions=development',
            '--import',
            'tsx',
            'src/ingestion/cli/data.ts',
            'issues',
            'repair',
            '--plan',
            filename,
            ...args,
          ],
          {
            cwd: new URL('../../', import.meta.url),
            env: { ...process.env, DATABASE_URL: `file:${join(directory, 'test.db')}` },
          },
        );

        return JSON.parse(stdout);
      };
      const proposal = await invoke();
      expect(proposal).toMatchObject({ mode: 'preview', changedRecords: 1, marketRevision: 40 });
      expect(await database.ingestionIssueResolution.count()).toBe(0);
      expect((await database.daily.findFirstOrThrow()).low).toBe(20.81);
      const applied = await invoke('--apply', '--expect-plan', proposal.planHash);
      expect(applied).toMatchObject({
        mode: 'applied',
        changedRecords: 1,
        marketRevision: 41,
        backup: expect.any(String),
      });
      expect((await database.daily.findFirstOrThrow()).low).toBe(20.15);
      expect(await invoke('--apply', '--expect-plan', proposal.planHash)).toMatchObject({
        mode: 'already_applied',
        marketRevision: 41,
      });
      const bundle = await exportIngestionIssues({ runId, code });
      expect(bundle.run.status).toBe('completed_with_issues');
      expect(bundle.counts.handling).toMatchObject({
        resolved: { warning: 1 },
        accepted: { error: 1 },
      });
    }),
  60_000,
);

it(
  'rejects stale previews and out-of-scope targets, and rolls back when resolution registration fails',
  async () =>
    withSyncDatabase(async (database) => {
      await seed(database);
      const action = await template('price-warning', 'update');
      const plan = issueRepairPlanSchema.parse({
        runId,
        actions: [{ ...action, values: { low: 20.15 } }],
      });
      const original = await preview(plan);
      await database.marketDataState.update({ where: { key: 'global' }, data: { revision: 41 } });
      const apply = (expectedHash: string) =>
        repairIngestionIssues(plan, { expectedHash, backup: async () => 'fixture' });
      await expect(apply(original.planHash)).rejects.toMatchObject({
        reason: 'repair_plan_changed',
      });
      const wrongIssue = issueRepairPlanSchema.parse({
        runId,
        actions: [{ ...action, issueIds: ['dividend-error'], values: { low: 20.15 } }],
      });
      await expect(preview(wrongIssue)).rejects.toMatchObject({ reason: 'repair_scope_mismatch' });
      await database.$executeRawUnsafe(`CREATE TRIGGER refuse_repair BEFORE INSERT ON "IngestionIssueResolution"
      BEGIN SELECT RAISE(ABORT, 'controlled repair registration failure'); END`);
      const current = await preview(plan);
      await expect(apply(current.planHash)).rejects.toThrow();
      expect((await database.daily.findFirstOrThrow()).low).toBe(20.81);
      expect((await database.marketDataState.findFirstOrThrow()).revision).toBe(41);
      expect(await database.ingestionIssueResolution.count()).toBe(0);
    }),
  60_000,
);

it(
  'inserts a dividend by announcement identity, reopens without a revision bump, and verifies deletion by absence',
  async () =>
    withSyncDatabase(async (database) => {
      await seed(database);
      const apply = async (raw: unknown) => {
        const plan = issueRepairPlanSchema.parse(raw);
        const proposal = await preview(plan);

        return repairIngestionIssues(plan, {
          expectedHash: proposal.planHash,
          backup: async () => 'fixture',
        });
      };
      await apply({
        runId,
        actions: [
          {
            op: 'insert',
            issueIds: ['dividend-error'],
            dataset: 'dividends',
            key: reportKey,
            values: { cashDivTax: 0.13, stockDividend: 0.7, stockCapitalizationRate: 0.7 },
            reason: 'Published proposal',
            evidence,
          },
        ],
      });
      expect(await database.dividend.findFirst()).toMatchObject({
        ...reportKey,
        cashDivTax: 0.13,
        cashDiv: null,
        availabilityQuality: 'latest_only',
        id: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(
        await apply({ runId, actions: [await template('dividend-error', 'reopen')] }),
      ).toMatchObject({ mode: 'applied', marketRevision: 41, changedRecords: 0 });
      expect(
        await database.ingestionIssueResolution.findUnique({
          where: { issueId: 'dividend-error' },
        }),
      ).toMatchObject({
        status: 'pending',
        resolvedAt: null,
        history: [expect.objectContaining({ status: 'resolved' })],
      });

      expect(
        await apply({ runId, actions: [await template('dividend-error', 'delete')] }),
      ).toMatchObject({ mode: 'applied', marketRevision: 42, changedRecords: 1 });
      expect(await database.dividend.count()).toBe(0);
      const bundle = await exportIngestionIssues({ runId, code, issueId: 'dividend-error' });
      expect(bundle.items[0].handling).toMatchObject({
        status: 'resolved',
        verification: 'verified',
      });
    }),
  60_000,
);

it('rejects SQL, explicit database identifiers and fields outside the business contract', () => {
  const base = {
    runId,
    actions: [
      {
        op: 'insert',
        issueIds: ['price-warning'],
        dataset: 'stock-prices',
        key,
        values: { ...quote, low: 20.15 },
        reason: 'Verified source',
        evidence,
      },
    ],
  };
  expect(issueRepairPlanSchema.safeParse(base).success).toBe(true);
  for (const extra of [
    { sql: 'UPDATE Daily' },
    { table: 'Daily' },
    { values: { ...quote, id: 'forged' } },
  ]) {
    expect(
      issueRepairPlanSchema.safeParse({ ...base, actions: [{ ...base.actions[0], ...extra }] })
        .success,
    ).toBe(false);
  }
});
