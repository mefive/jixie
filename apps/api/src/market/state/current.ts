import { getDatabase } from '#infra/database/prisma.js';
import { MARKET_AUDIT_VERSION, MARKET_CALCULATION_VERSION } from './eligibility.js';

/**
 * 历史行存在不等于当前合格；失效或旧版本结果只保留身份和实际样本数量。
 *
 * Stored history is not current eligibility; stale or legacy results retain identity and actual
 * sample counts only.
 */
export async function currentDerivedRows<Row extends { tradeDate: string }>(
  rows: Row[],
): Promise<Row[]> {
  const states = await getDatabase().marketCalculationState.findMany({
    where: { kind: 'market-state', date: { in: [...new Set(rows.map((row) => row.tradeDate))] } },
  });

  return rows.map((row) => {
    const state = states.find((entry) => entry.date === row.tradeDate);
    const scope =
      'indexCode' in row
        ? `index:${row.indexCode}`
        : 'l1Code' in row
          ? `industry:${row.l1Code}`
          : 'market';
    const versions = state?.inputVersions;
    const qualified =
      versions && typeof versions === 'object' && !Array.isArray(versions)
        ? versions.qualifiedScopes
        : null;
    const dirty = state?.dirtyScopes;
    const invalidated =
      state &&
      state.generation !== state.readyGeneration &&
      (!Array.isArray(dirty) ||
        dirty.includes('all') ||
        dirty.includes(scope) ||
        (scope.startsWith('industry:') && dirty.includes('industries')));
    if (
      state?.auditVersion === MARKET_AUDIT_VERSION &&
      state.calculationVersion === MARKET_CALCULATION_VERSION &&
      Array.isArray(qualified) &&
      qualified.includes(scope) &&
      !invalidated
    ) {
      return row;
    }

    return Object.fromEntries(
      Object.entries(row).map(([field, value]) => [
        field,
        typeof value === 'number' && field !== 'tradedCount' ? null : value,
      ]),
    ) as Row;
  });
}

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
