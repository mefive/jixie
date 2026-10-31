import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import {
  capturedAt,
  proveRange,
  proveStockCatalog,
  seedSessions,
} from '../../../tests/market-contract-fixtures.js';
import { withMaintenanceLock } from '#infra/coordination/market-access.js';
import { publishWindow, recordAttempt } from '#maintenance/publication.js';
import { prepareEtfPartition } from '../etfs/sync-partition.js';
import { prepareStockPartition } from '../stocks/sync-partition.js';
import { instrumentSeries } from '../queries/instrument-series.js';
import { assertPriceSeriesReadiness } from './readiness.js';

const startDate = '20121129';
const endDate = '20121130';
const etf = {
  tsCode: '159919.SZ',
  name: 'ETF',
  listStatus: 'L',
  exchange: 'SZ',
  listDate: startDate,
  sameDayTurnover: false,
};
const price = { ts_code: etf.tsCode, trade_date: startDate, open: 1, high: 1, low: 1, close: 1 };
const partition = { dataset: 'etf-prices', scope: etf.tsCode, startDate, endDate };

it('persists source absence annotations while completing acquisition and preserving sparse reads', async () =>
  withSyncDatabase(async (database) => {
    await seedSessions(database, startDate, endDate);
    await proveRange(database, { dataset: 'etf-master', scope: 'all', startDate, endDate });
    await database.etfBasic.create({ data: etf });
    await database.marketDownloadList.create({ data: { assetType: 'etf', codes: [etf.tsCode] } });
    await database.marketDataState.create({ data: { key: 'global' } });

    await withMaintenanceLock(async () => {
      for (const dataset of ['etf-prices', 'etf-adjustments']) {
        const planned = { ...partition, dataset, id: dataset, history: true };
        const rows =
          dataset === 'etf-prices'
            ? [price]
            : [startDate, endDate].map((date) => ({
                ts_code: etf.tsCode,
                trade_date: date,
                adj_factor: 1,
              }));
        const prepared = await prepareEtfPartition({ call: async () => rows }, planned);
        expect(prepared.status).toBe('complete');
        expect(prepared.gaps).toEqual([]);
        await recordAttempt(planned, 'source-absence', capturedAt);
        await publishWindow(planned, prepared, 'source-absence', capturedAt);
      }
    });

    const stored = await database.datasetSyncPartition.findUniqueOrThrow({
      where: { id: 'etf-prices' },
    });
    expect(stored).toMatchObject({ status: 'complete', error: null });
    expect(stored.gaps).toEqual([`Source returned no observations on sessions: ${endDate}`]);
    expect(
      await database.datasetSyncState.findUnique({
        where: { dataset_scope: { dataset: 'etf-prices', scope: etf.tsCode } },
      }),
    ).toMatchObject({ verifiedThrough: endDate, maxObservedDate: startDate });
    await expect(
      assertPriceSeriesReadiness('etf', etf.tsCode, startDate, endDate),
    ).resolves.toBeUndefined();
    expect(
      (await instrumentSeries('etf', etf.tsCode, startDate, endDate)).points.map(
        (point) => point.date,
      ),
    ).toEqual([startDate]);
  }));

it('accepts a complete empty source check without erasing known prices or certifying a failed retry', async () =>
  withSyncDatabase(async (database) => {
    await seedSessions(database, startDate, endDate);
    await database.etfBasic.create({ data: etf });
    await database.etfDaily.create({
      data: { tsCode: etf.tsCode, tradeDate: startDate, open: 1, high: 1, low: 1, close: 1 },
    });
    await database.marketDataState.create({ data: { key: 'global' } });
    const planned = { ...partition, id: 'empty-source', history: true };
    const empty = await prepareEtfPartition({ call: async () => [] }, planned);
    expect(empty).toMatchObject({
      status: 'complete',
      errors: [],
      gaps: [],
      checks: { sourceAbsences: true },
    });

    await withMaintenanceLock(async () => {
      await recordAttempt(planned, 'source-absence', capturedAt);
      const accepted = await publishWindow(planned, empty, 'source-absence', capturedAt);
      expect(accepted.accepted.deleted).toBe(0);
      const failed = await prepareEtfPartition(
        {
          call: async () => {
            throw new Error('Source unavailable');
          },
        },
        planned,
      );
      expect(failed.status).toBe('error');
      await publishWindow(planned, failed, 'source-absence', capturedAt);
    });

    expect(await database.etfDaily.count()).toBe(1);
    expect(
      await database.datasetSyncPartition.findUnique({ where: { id: planned.id } }),
    ).toMatchObject({ status: 'error' });
    expect(
      await database.datasetSyncState.findUnique({
        where: { dataset_scope: { dataset: partition.dataset, scope: partition.scope } },
      }),
    ).toMatchObject({ verifiedThrough: null });
  }));

it('rejects incomplete session-calendar proof even when the provider is trusted', async () =>
  withSyncDatabase(async (database) => {
    await database.tradeCal.create({ data: { exchange: 'SSE', calDate: startDate, isOpen: 1 } });
    const prepared = await prepareEtfPartition({ call: async () => [] }, partition);

    expect(prepared.status).toBe('partial');
    expect(prepared.gaps.join()).toContain('calendar');
    expect(prepared.notes).toBeUndefined();
  }));

it('accepts returned prices as evidence of trading despite an ordinary suspension row with no timing', async () =>
  withSyncDatabase(async (database) => {
    await seedSessions(database, startDate);
    await proveStockCatalog(database);
    const stock = {
      tsCode: '000078.SZ',
      symbol: '000078',
      name: 'Stock',
      exchange: 'SZSE',
      listStatus: 'L',
      listDate: '19910101',
    };
    await database.stockBasic.create({ data: stock });
    const prepared = await prepareStockPartition(
      {
        call: async (api) =>
          api === 'suspend_d'
            ? [
                {
                  ts_code: stock.tsCode,
                  trade_date: startDate,
                  suspend_type: 'S',
                  suspend_timing: null,
                },
              ]
            : [{ ...price, ts_code: stock.tsCode, vol: 10 }],
      },
      { dataset: 'stock-prices', scope: 'all', startDate, endDate: startDate },
    );

    expect(prepared).toMatchObject({ status: 'complete', errors: [], gaps: [] });
    expect(prepared.tables[0].records).toHaveLength(1);
    expect(prepared.notes?.join()).toContain('prices on suspension-record dates');
  }));

it('accepts zero limit placeholders and still rejects negative prices', async () =>
  withSyncDatabase(async (database) => {
    await seedSessions(database, startDate);
    await proveRange(database, {
      dataset: 'stock-prices',
      scope: 'all',
      startDate,
      endDate: startDate,
    });
    await database.stockBasic.create({
      data: {
        tsCode: '600637.SH',
        symbol: '600637',
        name: 'Paused',
        exchange: 'SSE',
        listStatus: 'L',
        listDate: '19910101',
      },
    });
    const planned = { dataset: 'stock-limits', scope: 'all', startDate, endDate: startDate };
    const row = {
      ts_code: '600637.SH',
      trade_date: startDate,
      up_limit: 0,
      down_limit: 0,
      exchange: 'SSE',
      asset_type: 'STK',
    };
    const prepared = await prepareStockPartition({ call: async () => [row] }, planned);
    expect(prepared).toMatchObject({ status: 'complete', errors: [], gaps: [] });
    expect(prepared.tables[0].records[0].values).toMatchObject({ upLimit: 0, downLimit: 0 });

    const invalid = await prepareStockPartition(
      { call: async () => [{ ...row, up_limit: -1 }] },
      planned,
    );
    expect(invalid.errors.join()).toContain('Invalid price limits');
  }));
