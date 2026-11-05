import { expect, it } from 'vitest';
import { DIVIDEND_SOURCE_FIELDS } from '#market/fundamentals/dividend-identity.js';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { compactSuccessfulReceipts } from './receipts.js';

it('never compacts successful receipts belonging to an unfinished logical run', async () =>
  withSyncDatabase(async (database) => {
    for (let index = 0; index < 22; index++) {
      await database.ingestionRun.create({
        data: {
          id: `run-${index}`,
          targetDate: '20181231',
          trigger: 'manual',
          scopeSnapshot: {},
          status: index === 0 ? 'interrupted' : 'completed',
          startedAt: new Date(index * 1000),
        },
      });
    }
    for (const index of [0, 21]) {
      await database.ingestionBatch.create({
        data: {
          id: `batch-${index}`,
          runId: `run-${index}`,
          dataset: 'dividends',
          scope: '600000.SH',
          period: 'all',
          api: 'dividend',
          request: {},
          status: 'succeeded',
          startedAt: new Date(index * 1000),
        },
      });
    }
    expect(await compactSuccessfulReceipts()).toBe(0);
    expect(await database.ingestionBatch.findUnique({ where: { id: 'batch-0' } })).not.toBeNull();
  }));

it('compacts superseded success detail while retaining issues and wider successful ranges', async () =>
  withSyncDatabase(async (database) => {
    for (let index = 0; index < 23; index++) {
      const runId = `run-${index}`;
      await database.ingestionRun.create({
        data: {
          id: runId,
          trigger: 'manual',
          targetDate: '20261030',
          status: 'completed',
          scopeSnapshot: {},
          startedAt: new Date(index * 1000),
        },
      });
      await database.ingestionBatch.create({
        data: {
          id: `batch-${index}`,
          runId,
          dataset: 'financial-statements',
          scope: 'income|1',
          period: '20260630',
          api: 'income_vip',
          request: {},
          status: 'succeeded',
          rangeStart: '20260630',
          rangeEnd: '20260630',
          startedAt: new Date(index * 1000),
        },
      });
    }
    await database.ingestionIssue.create({
      data: {
        id: 'retained-issue',
        runId: 'run-0',
        batchId: 'batch-0',
        category: 'record',
        reasonCode: 'fixture',
        message: 'Keep source row',
        payload: { raw: 1 },
      },
    });
    await database.ingestionBatch.create({
      data: {
        id: 'replacement-in-original-run',
        runId: 'run-0',
        dataset: 'financial-statements',
        scope: 'income|1',
        period: '20260630',
        api: 'income_vip',
        request: {},
        status: 'succeeded',
        rangeStart: '20260630',
        rangeEnd: '20260630',
        startedAt: new Date(1),
      },
    });
    await database.ingestionBatch.create({
      data: {
        id: 'wide-history',
        runId: 'run-0',
        dataset: 'index-prices',
        scope: '000300.SH',
        period: '2026',
        api: 'index_daily',
        request: {},
        status: 'succeeded',
        rangeStart: '20260101',
        rangeEnd: '20261030',
        startedAt: new Date(0),
      },
    });
    await database.ingestionBatch.create({
      data: {
        id: 'narrow-recheck',
        runId: 'run-22',
        dataset: 'index-prices',
        scope: '000300.SH',
        period: '2026',
        api: 'index_daily',
        request: {},
        status: 'succeeded',
        rangeStart: '20260101',
        rangeEnd: '20260930',
        startedAt: new Date(22000),
      },
    });
    const dividendReceipts = [
      {
        id: 'complete-dividend-history',
        index: 0,
        rangeEnd: '20181231',
        fields: DIVIDEND_SOURCE_FIELDS,
      },
      {
        id: 'narrow-dividend-history',
        index: 21,
        rangeEnd: '20181230',
        fields: DIVIDEND_SOURCE_FIELDS,
      },
      {
        id: 'incomplete-dividend-fields',
        index: 22,
        rangeEnd: '20190101',
        fields: 'ts_code,end_date',
      },
    ];
    for (const { id, index, rangeEnd, fields } of dividendReceipts) {
      await database.ingestionBatch.create({
        data: {
          id,
          runId: `run-${index}`,
          dataset: 'dividends',
          scope: '600000.SH',
          period: 'all',
          api: 'dividend',
          request: [{ api: 'dividend', params: { ts_code: '600000.SH' }, fields }],
          rangeEnd,
          status: 'succeeded',
          responseComplete: true,
          startedAt: new Date(index * 1000),
        },
      });
    }
    expect(await compactSuccessfulReceipts()).toBe(2);
    expect(
      await database.ingestionBatch.findUnique({ where: { id: 'complete-dividend-history' } }),
    ).not.toBeNull();
    expect(await database.ingestionBatch.findUnique({ where: { id: 'batch-0' } })).not.toBeNull();
    expect(
      await database.ingestionBatch.findUnique({ where: { id: 'replacement-in-original-run' } }),
    ).not.toBeNull();
    expect(await database.ingestionBatch.findUnique({ where: { id: 'batch-1' } })).toBeNull();
    expect(
      await database.ingestionBatch.findUnique({ where: { id: 'wide-history' } }),
    ).not.toBeNull();
    expect(
      await database.ingestionIssue.findUnique({ where: { id: 'retained-issue' } }),
    ).toMatchObject({ payload: { raw: 1 } });
  }));
