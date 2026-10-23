import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../../tests/sync-database.js';
import { calendarDay } from '#market/synchronization/date.js';
import { loadSnapshots } from '../../observations/cross-sectional/data.js';
import { refreshFactorWeatherPin, FACTOR_WEATHER_METHODOLOGY_HASH } from '../../weather/refresh.js';
import { createDefaultFactorAnalysisSpecV3 } from '../spec.js';
import { sha256 } from '../../sources/fingerprint.js';
import { analyzeFactor } from './evaluate.js';

const code = `export default defineFactor({ name: 'Fixture PB', compute(bar) { return bar.pb; } });`;

describe('forward observation maturity', () => {
  it(
    'R03/A03/A08/A13 evaluates realized periods and monthly weather with calendar lookahead beyond prices',
    async () =>
      withSyncDatabase(async (database) => {
        const through = '20240930';
        const dates = [];
        for (let date = '20240801'; date <= '20241031'; date = calendarDay(date, 1)) {
          const day = new Date(
            `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00Z`,
          ).getUTCDay();
          dates.push({ exchange: 'SSE', calDate: date, isOpen: day === 0 || day === 6 ? 0 : 1 });
        }
        await database.tradeCal.createMany({ data: dates });
        await database.datasetSyncPartition.createMany({
          data: ['calendar', 'stock-prices', 'stock-adjustments', 'stock-valuations'].map(
            (dataset) => ({
              id: dataset,
              dataset,
              scope: dataset === 'calendar' ? 'SSE' : 'all',
              startDate: '20240801',
              endDate: dataset === 'calendar' ? '20241031' : through,
              status: 'complete',
              policyVersion: 'sync-v1',
            }),
          ),
        });
        const stocks = Array.from({ length: 200 }, (_, index) => ({
          tsCode: `${600000 + index}.SH`,
          symbol: String(600000 + index),
          name: `Fixture ${index}`,
          listDate: '20100101',
          listStatus: 'L',
        }));
        await database.stockBasic.createMany({ data: stocks });
        await database.swIndustryMember.createMany({
          data: stocks.map((stock) => ({
            tsCode: stock.tsCode,
            l1Code: '801010.SI',
            l1Name: 'Fixture',
            inDate: '20100101',
          })),
        });
        for (const date of dates.filter((row) => row.isOpen && row.calDate <= through)) {
          const rows = stocks.map((stock, index) => ({
            tsCode: stock.tsCode,
            tradeDate: date.calDate,
            close: 10 * (1 + (date.calDate >= '20240901' ? (index % 17) * 0.001 : 0)),
            amount: 1000 + index * 100,
          }));
          await database.daily.createMany({ data: rows });
          await database.adjFactor.createMany({
            data: stocks.map((stock) => ({
              tsCode: stock.tsCode,
              tradeDate: date.calDate,
              adjFactor: 1,
            })),
          });
          await database.dailyBasic.createMany({
            data: stocks.map((stock, index) => ({
              tsCode: stock.tsCode,
              tradeDate: date.calDate,
              pb: 1 + ((index * 7) % 53),
              totalMv: 100 + (index % 25),
              circMv: 100,
              turnoverRate: 1,
            })),
          });
        }
        const spec = createDefaultFactorAnalysisSpecV3({
          freq: 'month',
          start: '20240801',
          end: through,
          neutral: 'none',
        });
        const report = await analyzeFactor('fixture', spec, () => {}, undefined, 'en', {
          kind: 'single',
          code,
          label: 'Fixture',
        });
        expect(report.periods).toBe(1);
        expect(report.periodObservations).toHaveLength(1);
        expect(report.periodObservations?.[0]).toMatchObject({
          formationDate: '20240830',
          periodEndDate: through,
        });
        expect(report.periodObservations?.[0].sampleSize).toBeGreaterThanOrEqual(100);
        const forward = await loadSnapshots(['20240930', '20241001'], false, 'forward');
        expect(forward.get(through)?.size).toBe(200);
        expect(forward.get('20241001')?.size).toBe(0);
        await expect(loadSnapshots(['20241001'], true)).rejects.toMatchObject({
          reason: 'inputs_not_ready',
        });

        await database.adjFactor.delete({
          where: { tsCode_tradeDate: { tsCode: stocks[0].tsCode, tradeDate: through } },
        });
        await expect(loadSnapshots([through], false, 'forward')).rejects.toMatchObject({
          reason: 'inputs_not_ready',
        });
        await database.adjFactor.create({
          data: { tsCode: stocks[0].tsCode, tradeDate: through, adjFactor: 1 },
        });

        await database.user.create({ data: { id: 'owner', email: 'fixture@example.invalid' } });
        await database.factor.create({
          data: { id: 'fixture', key: 'fixture', userId: 'owner', name: 'Fixture', code },
        });
        await database.factorWeatherPin.create({
          data: {
            id: 'weather',
            userId: 'owner',
            factorId: 'fixture',
            factorName: 'Fixture',
            builtin: false,
            direction: 'positive',
            factorCode: code,
            factorCodeHash: sha256(code),
            methodologyHash: FACTOR_WEATHER_METHODOLOGY_HASH,
          },
        });
        const weather = await refreshFactorWeatherPin('weather', {
          signal: AbortSignal.timeout(30_000),
        });
        expect(weather).toMatchObject({
          computedThrough: through,
          pointsWritten: 1,
          skipped: false,
        });
        expect(
          await database.factorWeatherPoint.findMany({ where: { pinId: 'weather' } }),
        ).toMatchObject([
          { formationDate: '20240830', periodEndDate: through, sampleSize: expect.any(Number) },
        ]);
      }),
    60_000,
  );
});
