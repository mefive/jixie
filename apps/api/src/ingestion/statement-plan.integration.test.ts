import { expect, it } from 'vitest';
import type { Prisma } from '#infra/database/prisma.js';
import {
  financialStatementSourceFields,
  type FinancialStatementKind,
} from '#market/fundamentals/source-contract.js';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { financialUnits } from './plan.js';
import { jsonValue } from './ingest.js';
import { planStatementUnits } from './statement-plan.js';

const startedAt = new Date('1991-01-07T08:00:00Z');

async function baseline(database: Prisma, targetDate = '19910104') {
  const capturedAt = new Date(
    Date.UTC(
      Number(targetDate.slice(0, 4)),
      Number(targetDate.slice(4, 6)) - 1,
      Number(targetDate.slice(6)) + 1,
      8,
    ),
  );
  const units = financialUnits(targetDate, capturedAt).filter(
    (unit) => unit.dataset === 'financial-statements',
  );
  await database.ingestionRun.create({
    data: {
      id: 'baseline',
      trigger: 'manual',
      targetDate,
      startedAt: capturedAt,
      finishedAt: capturedAt,
      status: 'completed',
      scopeSnapshot: jsonValue({
        version: 2,
        referenceUnits: [],
        selectionUnits: [],
        plan: { units, blocked: [], statementCodes: ['600000.SH'] },
      }),
    },
  });
  const rows = units.map((unit) => {
    const [kind, reportType] = unit.scope.split('|');

    return {
      id: `${unit.scope}/${unit.period}`,
      runId: 'baseline',
      dataset: unit.dataset,
      scope: unit.scope,
      period: unit.period,
      api: unit.api,
      rangeStart: unit.startDate,
      rangeEnd: unit.endDate,
      startedAt: capturedAt,
      status: 'succeeded',
      responseComplete: true,
      request: [
        {
          api: unit.api,
          params: { period: unit.period, report_type: reportType },
          fields: financialStatementSourceFields(kind as FinancialStatementKind).join(','),
        },
      ],
    };
  });
  for (let index = 0; index < rows.length; index += 200) {
    await database.ingestionBatch.createMany({ data: rows.slice(index, index + 200) });
  }

  return units;
}

it('reuses complete quarterly history and plans both disclosure streams, including empty days', async () =>
  withSyncDatabase(async (database) => {
    await baseline(database);
    const units = await planStatementUnits(['600000.SH'], '19910106', startedAt);

    expect(units).toHaveLength(36);
    expect(new Set(units.map(({ startDate }) => startDate))).toEqual(
      new Set(['19910105', '19910106']),
    );
    expect(new Set(units.map(({ announcementField }) => announcementField))).toEqual(
      new Set(['ann_date', 'f_ann_date']),
    );
    expect(units.every(({ catalogThrough }) => catalogThrough === '19910106')).toBe(true);
    expect(await planStatementUnits(['600000.SH'], '19910104', startedAt)).toEqual([]);

    await database.ingestionBatch.update({
      where: { id: 'income|1/19901231' },
      data: {
        request: [
          {
            api: 'income_vip',
            params: { period: '19901231', report_type: '1' },
            fields: 'ts_code',
          },
        ],
      },
    });
    const repaired = await planStatementUnits(['600000.SH'], '19910106', startedAt);

    expect(repaired.filter(({ announcementField }) => !announcementField)).toMatchObject([
      { scope: 'income|1', period: '19901231' },
    ]);
  }));

it('fills old-quarter holes and bootstraps a new security without repeating covered quarters', async () =>
  withSyncDatabase(async (database) => {
    await baseline(database);
    await database.ingestionBatch.delete({ where: { id: 'income|1/19880630' } });
    const units = await planStatementUnits(['600000.SH', '600001.SH'], '19910106', startedAt);

    expect(units.filter(({ period }) => period === '19880630')).toMatchObject([
      { scope: 'income|1' },
    ]);
    const histories = units.filter(({ fullHistory }) => fullHistory);
    expect(histories).toHaveLength(9);
    expect(histories.every(({ scope }) => scope.endsWith('|600001.SH'))).toBe(true);
    expect(histories.every(({ startDate }) => startDate === '19880101')).toBe(true);
    expect(units.filter(({ announcementField }) => announcementField)).toHaveLength(36);

    await database.ingestionRun.create({
      data: {
        id: 'new-security-history',
        trigger: 'manual',
        targetDate: '19910106',
        status: 'completed',
        startedAt,
        scopeSnapshot: jsonValue({
          version: 2,
          referenceUnits: [],
          selectionUnits: [],
          plan: { units: histories, blocked: [], statementCodes: ['600000.SH', '600001.SH'] },
        }),
      },
    });
    for (const unit of histories) {
      const [kind, reportType, code] = unit.scope.split('|');
      await database.ingestionBatch.create({
        data: {
          id: unit.scope,
          runId: 'new-security-history',
          dataset: unit.dataset,
          scope: unit.scope,
          period: unit.period,
          api: unit.api,
          rangeStart: unit.startDate,
          rangeEnd: unit.endDate,
          startedAt,
          status: 'succeeded',
          responseComplete: true,
          request: [
            {
              api: unit.api,
              params: { ts_code: code, report_type: reportType },
              fields: financialStatementSourceFields(kind as FinancialStatementKind).join(','),
            },
          ],
        },
      });
    }
    const next = await planStatementUnits(
      ['600000.SH', '600001.SH'],
      '19910331',
      new Date('1991-04-01T08:00:00Z'),
    );
    expect(next.filter(({ fullHistory }) => fullHistory)).toEqual([]);
  }));

it('recovers the legacy security universe from the saved complete-dividend plan', async () =>
  withSyncDatabase(async (database) => {
    const units = await baseline(database);
    await database.ingestionRun.update({
      where: { id: 'baseline' },
      data: {
        scopeSnapshot: jsonValue({
          version: 2,
          referenceUnits: [],
          selectionUnits: [],
          plan: {
            units: [
              ...units,
              {
                dataset: 'dividends',
                scope: '600000.SH',
                period: 'all',
                fullHistory: true,
                api: 'dividend',
                startDate: '',
                endDate: '19910104',
                refresh: true,
              },
            ],
            blocked: [],
          },
        }),
      },
    });
    const planned = await planStatementUnits(['600000.SH'], '19910106', startedAt);

    expect(planned).toHaveLength(36);
    expect(planned.every(({ announcementField }) => Boolean(announcementField))).toBe(true);
  }));

it('lets disclosure coverage carry a new report quarter and retains saved legacy plans', async () =>
  withSyncDatabase(async (database) => {
    await baseline(database, '19910330');
    const clock = new Date('1991-04-01T08:00:00Z');
    const units = await planStatementUnits(['600000.SH'], '19910331', clock);

    expect(units).toHaveLength(18);
    expect(units.every(({ startDate }) => startDate === '19910331')).toBe(true);
    expect(units.every(({ announcementField }) => Boolean(announcementField))).toBe(true);

    const run = await database.ingestionRun.findUniqueOrThrow({ where: { id: 'baseline' } });
    expect(JSON.stringify(run.scopeSnapshot)).toContain('statementCodes');
    expect(await database.ingestionBatch.count()).toBe(108);
  }));
