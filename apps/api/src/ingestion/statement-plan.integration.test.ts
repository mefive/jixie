import { expect, it } from 'vitest';
import type { Prisma } from '#infra/database/prisma.js';
import {
  financialStatementSourceFields,
  type FinancialStatementKind,
} from '#market/fundamentals/source-contract.js';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { jsonValue } from './ingest.js';
import { planStatementUnits } from './statement-plan.js';
import type { IngestionUnit } from './schema.js';

const code = '600000.SH';
const capturedAt = new Date('1991-01-06T08:00:00Z');
const nextCapture = new Date('1991-01-08T08:00:00Z');

async function recordPlan(
  database: Prisma,
  units: IngestionUnit[],
  targetDate: string,
  date = capturedAt,
  id = 'baseline',
  codes = [code],
) {
  await database.ingestionRun.create({
    data: {
      id,
      trigger: 'manual',
      targetDate,
      startedAt: date,
      finishedAt: date,
      status: 'completed',
      scopeSnapshot: jsonValue({
        version: 2,
        referenceUnits: [],
        selectionUnits: [],
        plan: { units, blocked: [], statementCodes: codes },
      }),
    },
  });
  const rows = units.map((unit) => {
    const [kind, reportType, security] = unit.scope.split('|');
    const params = unit.announcementRange
      ? { start_date: unit.startDate, end_date: unit.endDate, report_type: reportType }
      : {
          [security ? 'ts_code' : (unit.announcementField ?? 'period')]: security ?? unit.startDate,
          report_type: reportType,
        };

    return {
      id: `${id}/${unit.scope}/${unit.period}`,
      runId: id,
      dataset: unit.dataset,
      scope: unit.scope,
      period: unit.period,
      api: unit.api,
      rangeStart: unit.startDate,
      rangeEnd: unit.endDate,
      startedAt: date,
      finishedAt: date,
      status: 'succeeded',
      responseComplete: true,
      request: [
        {
          api: unit.api,
          params,
          fields: financialStatementSourceFields(kind as FinancialStatementKind).join(','),
        },
      ],
    };
  });
  await database.ingestionBatch.createMany({ data: rows });
}

it('uses announcement windows for historical data and exact actual dates only beyond capture evidence', async () =>
  withSyncDatabase(async (database) => {
    const initial = await planStatementUnits([code], '19910104', capturedAt);
    expect(
      initial.every((unit) => unit.announcementRange && unit.catalogThrough === '19910104'),
    ).toBe(true);
    expect(initial.find((unit) => unit.scope === 'income|1')).toMatchObject({
      period: 'ann_range/19880101/19881231',
    });
    expect(initial).toHaveLength(36);
    expect(initial.every(({ endDate }) => endDate <= '19910104')).toBe(true);
    await recordPlan(database, initial, '19910104');

    const historical = await planStatementUnits([code], '19910105', nextCapture);
    expect(historical.filter((unit) => !unit.announcementRange)).toEqual([]);
    expect(historical.find((unit) => unit.scope === 'income|1')).toMatchObject({
      period: 'ann_range/19910105/19910105',
    });

    const updated = await planStatementUnits([code], '19910107', nextCapture);
    const actualDays = updated.filter(
      ({ announcementField }) => announcementField === 'f_ann_date',
    );
    expect(actualDays).toHaveLength(18);
    expect(new Set(actualDays.map(({ startDate }) => startDate))).toEqual(
      new Set(['19910106', '19910107']),
    );

    const laterDate = new Date('1991-01-07T08:00:00Z');
    const existingActual = actualDays.find(
      ({ scope, period }) => scope === 'income|1' && period === 'f_ann_date/19910106',
    )!;
    await recordPlan(database, [existingActual], '19910106', laterDate, 'actual-day');
    expect(
      (await planStatementUnits([code], '19910107', nextCapture)).filter(
        ({ announcementField }) => announcementField === 'f_ann_date',
      ),
    ).toHaveLength(17);
  }));

it('retains quarterly receipts but requires announcement evidence and rechecks deferred windows', async () =>
  withSyncDatabase(async (database) => {
    await recordPlan(
      database,
      [
        {
          dataset: 'financial-statements',
          api: 'income_vip',
          scope: 'income|1',
          period: '19901231',
          startDate: '19901231',
          endDate: '19901231',
          refresh: true,
          catalogThrough: '19910104',
        },
      ],
      '19910104',
      capturedAt,
      'quarter',
    );
    const initial = await planStatementUnits([code], '19910104', capturedAt);
    expect(initial.some(({ period }) => period === 'ann_range/19880101/19881231')).toBe(true);
    await recordPlan(database, initial, '19910104');
    await database.ingestionBatch.updateMany({
      where: { runId: 'baseline', scope: 'income|1' },
      data: { rangeEnd: null },
    });
    const updated = await planStatementUnits([code, '600001.SH'], '19910105', nextCapture);
    expect(
      updated.find(
        ({ scope, period }) => scope === 'income|1' && period === 'ann_range/19910101/19910105',
      ),
    ).toBeDefined();
    const histories = updated.filter(({ fullHistory }) => fullHistory);
    expect(histories).toHaveLength(8);
    expect(histories.every((unit) => unit.scope.endsWith('|600001.SH'))).toBe(true);
    expect(updated).toHaveLength(20);
    expect(updated.every(({ endDate }) => endDate <= '19910105')).toBe(true);
    await recordPlan(database, updated, '19910105', nextCapture, 'bulk-replay', [
      code,
      '600001.SH',
    ]);
    const later = await planStatementUnits(
      [code, '600001.SH'],
      '19910107',
      new Date('1991-01-09T08:00:00Z'),
    );
    expect(later.filter(({ fullHistory }) => fullHistory)).toEqual([]);
    expect(
      await database.ingestionBatch.findUnique({
        where: { id: 'quarter/income|1/19901231' },
      }),
    ).not.toBeNull();
  }));

it('replays a narrow catalog window when it replaces more per-security history batches', async () =>
  withSyncDatabase(async (database) => {
    const initial = await planStatementUnits([code], '19910104', capturedAt);
    const narrow = initial.find(
      ({ scope, period }) => scope === 'income|1' && period === 'ann_range/19880101/19881231',
    )!;
    await recordPlan(
      database,
      [{ ...narrow, startDate: '19910104', period: 'ann_range/19910104/19910104' }],
      '19910104',
    );

    const updated = await planStatementUnits(
      [code, '600001.SH', '600002.SH'],
      '19910105',
      nextCapture,
    );
    expect(updated.filter(({ fullHistory }) => fullHistory)).toEqual([]);
    expect(updated.filter(({ scope }) => scope === narrow.scope).at(-1)).toMatchObject({
      announcementRange: true,
      catalogThrough: '19910105',
      startDate: '19910101',
      endDate: '19910105',
    });
  }));

it('reuses a stock history through its proven days and still checks later actual disclosures', async () =>
  withSyncDatabase(async (database) => {
    const initial = await planStatementUnits([code], '19910104', capturedAt);
    await recordPlan(database, initial, '19910104');

    const codes = [code, '600001.SH'];
    const next = await planStatementUnits(codes, '19910105', nextCapture);
    expect(next.filter((unit) => unit.fullHistory)).toHaveLength(9);
    expect(next.filter((unit) => unit.announcementRange).map((unit) => unit.startDate)).toEqual(
      Array(9).fill('19910105'),
    );
    await recordPlan(database, next, '19910105', nextCapture, 'backfill', codes);

    const later = await planStatementUnits(codes, '19910107', nextCapture);
    expect(later.filter((unit) => unit.fullHistory)).toEqual([]);
    expect(later.filter((unit) => unit.announcementRange)).toHaveLength(9);
    expect(later.every((unit) => unit.startDate >= '19910106')).toBe(true);
    const actual = later.filter((unit) => unit.announcementField === 'f_ann_date');
    expect(actual).toHaveLength(18);
    expect(new Set(actual.map((unit) => unit.startDate))).toEqual(
      new Set(['19910106', '19910107']),
    );
  }));
