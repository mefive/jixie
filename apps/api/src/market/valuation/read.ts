import { getDatabase } from '#infra/database/prisma.js';

import { buildIndexValuationSeries } from './compute.js';

/**
 * 读取可用指数估值目录及覆盖信息，供前端选择。
 *
 * Load available index valuation identities and coverage for selection.
 */
export async function loadIndexValuationCatalog() {
  const coverage = await getDatabase().indexDailyBasic.groupBy({
    by: ['tsCode'],
    _min: { tradeDate: true },
    _max: { tradeDate: true },
    _count: { _all: true },
  });
  const coverageByCode = new Map(coverage.map((row) => [row.tsCode, row]));
  const indices = [...coverageByCode.keys()].sort().flatMap((tsCode) => {
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

/**
 * 读取指定指数估值历史并生成查询所需序列。
 *
 * Load the requested index valuation history and prepare its response series.
 */
export async function loadIndexValuation(tsCode: string) {
  const [basicRows, closeRows] = await Promise.all([
    getDatabase().indexDailyBasic.findMany({
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
    getDatabase().indexDaily.findMany({
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
