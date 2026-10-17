import type { Prisma } from '#infra/database/prisma.js';

export const ETF_HISTORY_START = '20150101';

/**
 * 描述 ETF 历史检查目标及所需数据产品。
 * Describe ETF history targets and required data products.
 */
export interface EtfHistoryProduct {
  tsCode: string;
  listDate: string | null;
  delistDate: string | null;
}

/**
 * 定位缺失证券、日期和数据种类，供最小补齐。
 * Identify missing instrument, date and product keys for targeted repair.
 */
export interface EtfHistoryGap {
  tradeDate: string;
  activeCodes: string[];
  daily: string[];
  adjustment: string[];
  shareSize: string[];
}

/**
 * 逐个核对预期历史键，不能只靠记录数或首尾日期证明完整性。
 * Scan every expected key, not just row counts or the first/last stored date.
 */
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
