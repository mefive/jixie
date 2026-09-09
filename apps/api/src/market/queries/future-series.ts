import { prisma } from '../../infra/database/prisma.js';

export async function loadFutureSeries(code: string, start: string, end: string) {
  const mappings = await prisma.futureMapping.findMany({
    where: { continuousCode: code, tradeDate: { gte: start, lte: end } },
    select: { tradeDate: true, mappedTsCode: true },
    orderBy: { tradeDate: 'asc' },
  });
  const actualCodes = mappings.length
    ? [...new Set(mappings.map((row) => row.mappedTsCode))]
    : [code];
  const rows = await prisma.futureDaily.findMany({
    where: { tsCode: { in: actualCodes }, tradeDate: { gte: start, lte: end } },
    select: {
      tsCode: true,
      tradeDate: true,
      open: true,
      high: true,
      low: true,
      close: true,
      volume: true,
    },
    orderBy: { tradeDate: 'asc' },
  });
  const rowByKey = new Map(rows.map((row) => [`${row.tsCode}|${row.tradeDate}`, row]));
  const selectedRows = mappings.length
    ? mappings
        .map((mapping) => rowByKey.get(`${mapping.mappedTsCode}|${mapping.tradeDate}`))
        .filter((row): row is (typeof rows)[number] => row != null)
    : rows;
  if (selectedRows.length === 0) {
    return null;
  }
  return {
    tsCode: code,
    name: code,
    points: selectedRows.map((row) => ({
      date: row.tradeDate,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      vol: row.volume,
      pe: null,
      adjFactor: null,
    })),
  };
}
