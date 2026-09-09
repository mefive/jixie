import { prisma } from '../../infra/database/prisma.js';
import { MAJOR_INDEX_DAILY_BASIC_CODES } from '../registry/index-presets.js';
import { buildIndexValuationSeries } from './compute.js';

export async function loadIndexValuationCatalog() {
  const coverage = await prisma.indexDailyBasic.groupBy({
    by: ['tsCode'],
    where: { tsCode: { in: [...MAJOR_INDEX_DAILY_BASIC_CODES] } },
    _min: { tradeDate: true },
    _max: { tradeDate: true },
    _count: { _all: true },
  });
  const coverageByCode = new Map(coverage.map((row) => [row.tsCode, row]));
  const indices = MAJOR_INDEX_DAILY_BASIC_CODES.flatMap((tsCode) => {
    const row = coverageByCode.get(tsCode);
    return row?._min.tradeDate && row._max.tradeDate
      ? [
          {
            tsCode,
            startDate: row._min.tradeDate,
            endDate: row._max.tradeDate,
            rows: row._count._all,
          },
        ]
      : [];
  });

  return { indices };
}

export async function loadIndexValuation(tsCode: string) {
  if (!MAJOR_INDEX_DAILY_BASIC_CODES.some((code) => code === tsCode)) {
    return null;
  }

  const [basicRows, closeRows] = await Promise.all([
    prisma.indexDailyBasic.findMany({
      where: { tsCode },
      select: {
        tsCode: true,
        tradeDate: true,
        pe: true,
        peTtm: true,
        pb: true,
        turnoverRate: true,
      },
      orderBy: { tradeDate: 'asc' },
    }),
    prisma.indexDaily.findMany({
      where: { tsCode },
      select: { tradeDate: true, close: true },
      orderBy: { tradeDate: 'asc' },
    }),
  ]);
  const series = buildIndexValuationSeries(tsCode, basicRows, closeRows);
  if (!series) {
    return null;
  }

  return series;
}
