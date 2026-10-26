import { getDatabase } from '#infra/database/prisma.js';

/**
 * 每个产品独立暴露已合格的连续收益；一个缺失产品不会隐藏其他产品。
 *
 * Expose qualified continuous returns per product without hiding independently ready products.
 */
export async function currentCommodityRows<Row extends { tradeDate: string; productCode: string }>(
  rows: Row[],
): Promise<Row[]> {
  const states = await getDatabase().marketCalculationState.findMany({
    where: {
      kind: 'commodity-continuous',
      date: { in: [...new Set(rows.map((row) => row.tradeDate))] },
    },
  });

  return rows.filter((row) =>
    states.some((state) => {
      const versions = state.inputVersions;
      const readyProducts =
        versions && typeof versions === 'object' && !Array.isArray(versions)
          ? versions.readyProducts
          : null;

      return (
        state.date === row.tradeDate &&
        ['ready', 'waiting'].includes(state.status) &&
        state.readyGeneration === state.generation &&
        Array.isArray(readyProducts) &&
        readyProducts.includes(row.productCode)
      );
    }),
  );
}
