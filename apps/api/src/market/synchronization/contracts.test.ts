import { afterEach, describe, expect, it, vi } from 'vitest';
import { TushareClient } from '../providers/tushare/tushare-client.js';
import { fetchSourcePages } from './source.js';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import {
  acceptSource,
  proveRange,
  seedSessions,
  currentPolicy,
  capturedAt,
} from '../../../tests/market-contract-fixtures.js';
import { datasetInputReadiness } from './readiness.js';
import { selectSyncWindow } from '#maintenance/partitions.js';
import { prepareMarketPartition } from './prepare.js';

// 真实事故形状，测试不访问供应商。
// Real incident shapes; tests never contact the provider.
afterEach(() => vi.unstubAllGlobals());

describe('source protocol boundaries', () => {
  it.each([
    { fields: ['ts_code'] },
    { fields: ['ts_code', 'trade_date'], items: [['600000.SH']] },
    { fields: ['ts_code', 'ts_code'], items: [['600000.SH', '600000.SH']] },
    { fields: ['ts_code'], items: [[{}]] },
    null,
  ])('rejects malformed columnar payloads before they become empty datasets: %j', async (data) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: 0, data }))),
    );
    const client = new TushareClient({ token: 'fixture', maxRetries: 0, minIntervalMs: 0 });
    await expect(client.call('dividend', { ts_code: '600000.SH' })).rejects.toThrow('Malformed');
  });

  it('accepts a structurally valid empty response without treating missing items as empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 0,
              data: { fields: [], items: [] },
            }),
          ),
      ),
    );
    const client = new TushareClient({ token: 'fixture', maxRetries: 0, minIntervalMs: 0 });
    await expect(
      client.call('dividend', { ts_code: '600000.SH' }, 'ts_code,end_date'),
    ).resolves.toEqual([]);
  });

  it('does not invent offset support or accept an undocumented date parameter for dividends', async () => {
    const source = { call: vi.fn(async () => []) };
    expect(
      (await fetchSourcePages(source, 'dividend', { ts_code: '600000.SH' }, 'ts_code')).complete,
    ).toBe(true);
    expect(source.call).toHaveBeenCalledWith('dividend', { ts_code: '600000.SH' }, 'ts_code');
    await expect(
      fetchSourcePages(source, 'dividend', { start_date: '20260101' }, 'ts_code'),
    ).rejects.toThrow('undeclared');
  });
});

describe('dataset-specific progress and dependencies', () => {
  it('treats no new monthly weight snapshot as a completed check and keeps the previous snapshot', async () =>
    withSyncDatabase(async (database) => {
      await database.indexWeight.create({
        data: { indexCode: '000300.SH', conCode: '600000.SH', tradeDate: '20260831', weight: 100 },
      });
      const result = await acceptSource(
        database,
        { call: async () => [] },
        {
          dataset: 'index-weights',
          scope: '000300.SH',
          startDate: '20260901',
          endDate: '20260916',
        },
      );
      expect(result.prepared.status).toBe('complete');
      expect(result.prepared.observedDates).toEqual([]);
      expect(await database.indexWeight.findFirst()).toMatchObject({ tradeDate: '20260831' });
    }));

  it('discovers index source history without importing future rows into a historical target', async () =>
    withSyncDatabase(async () => {
      const partition = {
        dataset: 'index-valuations',
        scope: '000852.SH',
        startDate: '20040101',
        endDate: '20041231',
      };
      const result = await prepareMarketPartition(
        {
          source: { call: async () => [{ ts_code: '000852.SH', trade_date: '20141017', pe: 20 }] },
        },
        partition,
        capturedAt,
      );
      expect(result.sourceStartDate).toBe('20141017');
      expect(result.status).toBe('not_applicable');
      expect(result.tables[0].records).toEqual([]);
    }));

  it('rejects stale calendar rules for both stock and ETF consumers', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20260916');
      await database.datasetSyncPartition.updateMany({
        where: { dataset: 'calendar' },
        data: { policyVersion: 'sync-v1' },
      });
      for (const [dataset, scope] of [
        ['stock-prices', 'all'],
        ['etf-prices', '510300.SH'],
      ]) {
        const requirement = { dataset, scope, startDate: '20260916', endDate: '20260916' };
        await proveRange(database, requirement);
        expect((await datasetInputReadiness([requirement])).ready).toBe(false);
      }
    }));

  it('prepares calendar coverage for actual capture even when the requested market target is historical', async () =>
    withSyncDatabase(async () => {
      const window = await selectSyncWindow({
        policy: currentPolicy('calendar'),
        targetDate: '20260916',
        startedAt: new Date('2026-10-29T10:00:00Z'),
        history: false,
        attempted: new Set(),
        deadline: Date.now() + 10000,
      });
      expect(window?.endDate).toBe('20261129');
    }));

  it('does not schedule a report period before that quarter has ended', async () =>
    withSyncDatabase(async () => {
      const window = await selectSyncWindow({
        policy: currentPolicy('financial-indicators'),
        targetDate: '20260930',
        startedAt: new Date('2026-09-30T02:00:00Z'),
        history: false,
        attempted: new Set(),
        deadline: Date.now() + 10000,
      });
      expect(window?.endDate).toBe('20260630');
    }));
});
