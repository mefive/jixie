import type { Prisma } from '#infra/database/prisma.js';

export const ETF_HISTORY_START = '20150101';

export interface EtfHistoryProduct {
  tsCode: string;
  listDate: string | null;
  delistDate: string | null;
}

export interface EtfHistoryGap {
  tradeDate: string;
  activeCodes: string[];
  daily: string[];
  adjustment: string[];
  shareSize: string[];
}

/** Scan every expected key, not just row counts or the first/last stored date. */
export async function inspectEtfHistoryCoverage(
  database: Prisma,
  products: EtfHistoryProduct[],
  dates: string[],
): Promise<EtfHistoryGap[]> {
  if (dates.length === 0) {
    return [];
  }
  for (const product of products) {
    if (!product.listDate) {
      throw new Error(`ETF history requires a listing date for ${product.tsCode}`);
    }
  }
  const where = {
    tsCode: { in: products.map((product) => product.tsCode) },
    tradeDate: { gte: dates[0], lte: dates.at(-1)! },
  };
  const select = { tsCode: true, tradeDate: true } as const;
  const datasets = await Promise.all([
    database.etfDaily.findMany({ where, select }),
    database.etfAdjFactor.findMany({ where, select }),
    database.etfShareSize.findMany({ where, select }),
  ]);
  const [daily, adjustment, shareSize] = datasets.map(
    (rows) => new Set(rows.map((row) => `${row.tradeDate}|${row.tsCode}`)),
  );
  return dates.map((tradeDate) => {
    const activeCodes = products
      .filter(
        (product) =>
          product.listDate! <= tradeDate &&
          (!product.delistDate || product.delistDate >= tradeDate),
      )
      .map((product) => product.tsCode);
    return {
      tradeDate,
      activeCodes,
      daily: activeCodes.filter((code) => !daily.has(`${tradeDate}|${code}`)),
      adjustment: activeCodes.filter((code) => !adjustment.has(`${tradeDate}|${code}`)),
      shareSize: activeCodes.filter((code) => !shareSize.has(`${tradeDate}|${code}`)),
    };
  });
}
