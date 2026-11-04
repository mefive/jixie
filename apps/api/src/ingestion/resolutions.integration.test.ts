import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { Prisma } from '#infra/database/prisma.js';
import { withSyncDatabase } from '../../tests/sync-database.js';
import {
  ensureRunIssueResolutions,
  recordIssueResolution,
  reconcileIssueResolutions,
} from './resolutions.js';
import { readIssueOverview, getIngestionIssueList } from './issue-overview.js';
import { exportIngestionIssues } from './issue-export.js';
import type { RecordIssueResolutionInput } from './resolution-schema.js';
import { Hono } from 'hono';
import { handleApiError } from '#infra/http/errors.js';
import { ingestionRoute } from './routes.js';

async function seed(database: Prisma) {
  const unit = {
    dataset: 'stock-prices',
    scope: 'SSE,SZSE',
    period: '19920131',
    api: 'daily',
    refresh: false,
    startDate: '19920131',
    endDate: '19920131',
  };
  await database.ingestionRun.create({
    data: {
      id: 'old-run',
      trigger: 'manual',
      targetDate: '20181231',
      status: 'completed',
      finishedAt: new Date('2026-11-01'),
      scopeSnapshot: {
        version: 2,
        referenceUnits: [],
        selectionUnits: [],
        plan: { units: [unit], blocked: [] },
      },
      summary: { succeeded: 1, partial: 0, failed: 0, rejected: 0 },
    },
  });
  for (const [id, startedAt] of [
    ['old-batch', '2026-10-30'],
    ['latest-batch', '2026-10-31'],
  ]) {
    await database.ingestionBatch.create({
      data: {
        id,
        runId: 'old-run',
        dataset: unit.dataset,
        scope: unit.scope,
        period: unit.period,
        api: 'daily',
        status: 'succeeded',
        request: [],
        startedAt: new Date(startedAt),
        rangeStart: unit.startDate,
        rangeEnd: unit.endDate,
        responseComplete: true,
      },
    });
  }
  for (const [id, batchId] of [
    ['historical', 'old-batch'],
    ['warning', 'latest-batch'],
  ]) {
    await database.ingestionIssue.create({
      data: {
        id,
        batchId,
        runId: 'old-run',
        category: 'record',
        severity: 'warning',
        reasonCode: 'ohlc_range_inconsistent',
        message: 'Range inconsistency',
        businessKey: { tsCode: '000003.SZ', tradeDate: '19920131' },
        payload: { ts_code: '000003.SZ', trade_date: '19920131', privatePayloadSentinel: true },
      },
    });
  }
  await database.daily.create({
    data: {
      tsCode: '000003.SZ',
      sourceTsCode: '000003.SZ',
      tradeDate: '19920131',
      open: 20.15,
      high: 20.85,
      low: 20.81,
      close: 20.75,
    },
  });
  await database.marketDataState.create({ data: { key: 'global', revision: 1 } });
}

const repair: RecordIssueResolutionInput = {
  issueId: 'warning',
  status: 'resolved',
  reason: 'Aligned unadjusted vendor quotes support the corrected low.',
  evidence: ['https://example.com/saved-vendor-evidence'],
  marketRevision: 2,
  before: [
    { table: 'Daily', key: { tsCode: '000003.SZ', tradeDate: '19920131' }, values: { low: 20.81 } },
  ],
  after: [
    { table: 'Daily', key: { tsCode: '000003.SZ', tradeDate: '19920131' }, values: { low: 20.15 } },
  ],
};

it(
  'reconciles warning-only completed runs idempotently without treating historical attempts as repaired',
  async () =>
    withSyncDatabase(async (database) => {
      await seed(database);
      const run = await database.ingestionRun.findUniqueOrThrow({ where: { id: 'old-run' } });
      expect((await reconcileIssueResolutions()).created).toBe(1);
      expect((await reconcileIssueResolutions()).created).toBe(0);
      expect(await database.ingestionIssueResolution.count()).toBe(1);
      expect(
        await database.ingestionIssueResolution.findUnique({ where: { issueId: 'historical' } }),
      ).toBeNull();
      await database.$transaction((transaction) =>
        recordIssueResolution(transaction, {
          issueId: 'warning',
          status: 'accepted',
          reason: 'Reviewed and accepted as source history.',
          evidence: ['saved-evidence'],
          marketRevision: 1,
        }),
      );
      const handled = await database.ingestionIssueResolution.findUniqueOrThrow({
        where: { issueId: 'warning' },
      });
      await reconcileIssueResolutions();
      expect(
        await database.ingestionIssueResolution.findUnique({ where: { issueId: 'warning' } }),
      ).toEqual(handled);
      expect(await database.ingestionRun.findUniqueOrThrow({ where: { id: 'old-run' } })).toEqual(
        run,
      );
    }),
  60_000,
);

it(
  'does not reconcile running runs, and reads missing records as pending without writing',
  async () =>
    withSyncDatabase(async (database) => {
      await seed(database);
      await database.ingestionRun.update({
        where: { id: 'old-run' },
        data: { status: 'running', finishedAt: null },
      });
      const result = await database.$transaction((transaction) =>
        ensureRunIssueResolutions(transaction, 'old-run'),
      );
      expect(result.skippedRunning).toBe(true);
      const overview = await database.$transaction((transaction) =>
        readIssueOverview(transaction, 'old-run'),
      );
      expect(overview.health.handling.pending.warning).toBe(1);
      expect(overview.health.missingResolutionRecords).toBe(1);
      expect(await database.ingestionIssueResolution.count()).toBe(0);
      await expect(
        database.$transaction((transaction) => recordIssueResolution(transaction, repair)),
      ).rejects.toMatchObject({ reason: 'resolution_not_ready' });
    }),
  60_000,
);

it(
  'keeps earlier pending issues visible after a new clean run and returns safe paginated details',
  async () =>
    withSyncDatabase(async (database) => {
      await seed(database);
      await database.ingestionRun.create({
        data: {
          id: 'new-clean-run',
          trigger: 'manual',
          targetDate: '20191231',
          status: 'completed',
          finishedAt: new Date('2026-11-02'),
          scopeSnapshot: {},
        },
      });
      const overview = await database.$transaction((transaction) =>
        readIssueOverview(transaction, 'new-clean-run'),
      );
      expect(overview.health.latestRun?.handling.pending.warning).toBe(0);
      expect(overview.health.handling.pending.warning).toBe(1);
      const details = await getIngestionIssueList({ offset: 0, limit: 1 });
      expect(details.total).toBe(1);
      expect(details.items[0].id).toBe('warning');
      expect(JSON.stringify(details)).not.toContain('privatePayloadSentinel');
      expect((await getIngestionIssueList({ offset: 1, limit: 1 })).items).toEqual([]);
    }),
  60_000,
);

it(
  'rolls back data, revision and handling together, then verifies successful repairs and detects later overwrites',
  async () =>
    withSyncDatabase(async (database) => {
      await seed(database);
      await reconcileIssueResolutions();
      const beforeRun = await database.ingestionRun.findUniqueOrThrow({ where: { id: 'old-run' } });
      const apply = async (fail: boolean) =>
        database.$transaction(async (transaction) => {
          await transaction.daily.update({
            where: { tsCode_tradeDate: { tsCode: '000003.SZ', tradeDate: '19920131' } },
            data: { low: 20.15 },
          });
          await transaction.marketDataState.update({
            where: { key: 'global' },
            data: { revision: { increment: 1 } },
          });
          await recordIssueResolution(transaction, repair);
          if (fail) {
            throw new Error('controlled rollback');
          }
        });
      await expect(apply(true)).rejects.toThrow('controlled rollback');
      expect((await database.daily.findFirstOrThrow()).low).toBe(20.81);
      expect((await database.marketDataState.findFirstOrThrow()).revision).toBe(1);
      expect((await database.ingestionIssueResolution.findFirstOrThrow()).status).toBe('pending');
      await apply(false);
      await reconcileIssueResolutions();
      const overview = await database.$transaction((transaction) =>
        readIssueOverview(transaction, 'old-run'),
      );
      expect(overview.health.handling.resolved.warning).toBe(1);
      const bundle = await exportIngestionIssues({
        runId: 'old-run',
        code: { commit: 'test', sourceDirty: false },
      });
      expect(bundle.counts.handling).toEqual(overview.health.handling);
      expect(bundle.items[0].handling).toMatchObject({
        status: 'resolved',
        verification: 'verified',
      });
      expect(bundle.items[0].resolution).toMatchObject({ status: 'resolved' });
      expect(bundle.items[0].resolution).not.toHaveProperty('after');
      await database.daily.updateMany({ data: { low: 20.81 } });
      const changed = await database.$transaction((transaction) =>
        readIssueOverview(transaction, 'old-run', true),
      );
      expect(changed.health.handling.pending.warning).toBe(1);
      expect(changed.items[0].verification).toBe('changed');
      expect((await database.ingestionIssueResolution.findFirstOrThrow()).status).toBe('resolved');
      const previousResolution = await database.ingestionIssueResolution.findFirstOrThrow();
      await database.$transaction(async (transaction) => {
        await transaction.daily.updateMany({ data: { low: 20.15 } });
        await transaction.marketDataState.update({
          where: { key: 'global' },
          data: { revision: 3 },
        });
        await recordIssueResolution(transaction, {
          ...repair,
          marketRevision: 3,
          previousResolutionUpdatedAt: previousResolution.updatedAt.toISOString(),
        });
      });
      expect((await database.ingestionIssueResolution.findFirstOrThrow()).history).toHaveLength(1);
      expect(await database.ingestionRun.findUniqueOrThrow({ where: { id: 'old-run' } })).toEqual(
        beforeRun,
      );
    }),
  60_000,
);

it(
  'protects issue details with authentication and preserves bounded read-only HTTP output',
  async () =>
    withSyncDatabase(async (database) => {
      await seed(database);
      const app = new Hono();
      app.onError(handleApiError);
      app.route('/api/ingestion', ingestionRoute);
      expect((await app.request('/api/ingestion/issues')).status).toBe(401);
      await database.user.create({ data: { id: 'viewer', email: 'viewer@example.test' } });
      await database.session.create({
        data: { id: 'viewer-session', userId: 'viewer', expiresAt: new Date(Date.now() + 60_000) },
      });
      const headers = { Cookie: 'sid=viewer-session' };
      expect((await app.request('/api/ingestion/issues?limit=101', { headers })).status).toBe(400);
      const response = await app.request('/api/ingestion/issues?limit=1', { headers });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.total).toBe(1);
      expect(JSON.stringify(body)).not.toContain('privatePayloadSentinel');
      expect(await database.ingestionIssueResolution.count()).toBe(0);
      const status = await app.request('/api/ingestion/status');
      expect(status.status).toBe(200);
      expect((await status.json()).health.handling.pending.warning).toBe(1);
      expect(await database.ingestionIssueResolution.count()).toBe(0);
    }),
  60_000,
);

it(
  'rejects a stale revision or unverified fields instead of marking the issue fixed',
  async () =>
    withSyncDatabase(async (database) => {
      await seed(database);
      await expect(
        database.$transaction((transaction) => recordIssueResolution(transaction, repair)),
      ).rejects.toMatchObject({ reason: 'resolution_verification_failed' });
      await database.marketDataState.update({ where: { key: 'global' }, data: { revision: 2 } });
      await expect(
        database.$transaction((transaction) => recordIssueResolution(transaction, repair)),
      ).rejects.toMatchObject({ reason: 'resolution_verification_failed' });
      expect(await database.ingestionIssueResolution.count()).toBe(0);
    }),
  60_000,
);

it(
  'runs the explicit reconcile CLI repeatedly without providers or resetting results',
  async () =>
    withSyncDatabase(async (database, directory) => {
      await seed(database);
      const invoke = async () => {
        const result = await promisify(execFile)(
          process.execPath,
          [
            '--conditions=development',
            '--import',
            'tsx',
            'src/ingestion/cli/data.ts',
            'issues',
            'reconcile',
            'old-run',
          ],
          {
            cwd: new URL('../../', import.meta.url),
            env: {
              ...process.env,
              DATABASE_URL: `file:${join(directory, 'test.db')}`,
              TUSHARE_TOKEN: '',
            },
          },
        );

        return JSON.parse(result.stdout);
      };
      expect((await invoke()).created).toBe(1);
      expect((await invoke()).created).toBe(0);
      expect((await database.marketDataState.findFirstOrThrow()).revision).toBe(1);
    }),
  60_000,
);

it(
  'archives covered legacy issues and separates unconfirmed evidence from the pending counter',
  async () =>
    withSyncDatabase(async (database) => {
      await seed(database);
      await database.ingestionRun.update({
        where: { id: 'old-run' },
        data: { scopeSnapshot: {}, startedAt: new Date('2026-10-30') },
      });
      await database.ingestionRun.create({
        data: {
          id: 'later-run',
          trigger: 'manual',
          targetDate: '20181231',
          status: 'completed',
          startedAt: new Date('2026-11-02'),
          finishedAt: new Date('2026-11-03'),
          scopeSnapshot: {},
        },
      });
      const data = {
        id: 'later-receipt',
        runId: 'later-run',
        dataset: 'stock-prices',
        scope: 'SSE,SZSE',
        period: '19920131',
        api: 'daily',
        status: 'succeeded',
        request: [],
        startedAt: new Date('2026-11-02'),
        rangeStart: '19920131',
        rangeEnd: '19920131',
        responseComplete: false,
      };
      await database.ingestionBatch.create({ data });
      const read = () =>
        database.$transaction((transaction) => readIssueOverview(transaction, 'later-run', true));
      const unconfirmed = await read();
      expect(unconfirmed.health.handling.pending.warning).toBe(0);
      expect(unconfirmed.health.unknownValidity).toBe(1);
      expect(unconfirmed.items).toMatchObject([{ id: 'warning', status: 'review' }]);

      await database.ingestionBatch.update({
        where: { id: data.id },
        data: { responseComplete: true },
      });
      const covered = await read();
      expect(covered.health.coveredHistorical).toBe(1);
      expect(covered.health.unknownValidity).toBe(0);
      expect(covered.items).toEqual([]);
      const bundle = await exportIngestionIssues({
        runId: 'old-run',
        code: { commit: 'test', sourceDirty: false },
      });
      expect(bundle.historicalIssues).toContainEqual(
        expect.objectContaining({
          id: 'warning',
          classification: 'covered_by_later_run',
          coverage: expect.objectContaining({ receiptIds: [data.id] }),
        }),
      );
      expect(await database.ingestionIssue.count()).toBe(2);
      expect(await database.ingestionIssueResolution.count()).toBe(0);
    }),
  60_000,
);
