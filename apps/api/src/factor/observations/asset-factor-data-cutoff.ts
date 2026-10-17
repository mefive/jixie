import type { FactorResearchSpecV1 } from '@jixie/shared';
import {
  commodityFutureProductCodesForEtfs,
  commodityWarehouseReceiptProductCodesForEtfs,
} from '#market/commodity/commodity-futures.js';
import { prisma, type Prisma } from '#infra/database/prisma.js';

/**
 * 声明资产因子所需市场数据，供共同截止日计算。
 *
 * Declare asset-factor datasets used to resolve a common cutoff.
 */
export interface AssetFactorDataRequirements {
  commodityCarry?: boolean;
  commodityWarehouseReceipts?: boolean;
}

/**
 * 根据资产因子声明的输入数据集取共同可用截止日。
 *
 * Resolve the common available cutoff across an asset factor's declared datasets.
 */
export async function resolveAssetFactorDataCutoff(
  researchSpec: Extract<FactorResearchSpecV1, { analysisKind: 'time_series' | 'panel' }>,
  requirements: AssetFactorDataRequirements = {},
  database: Prisma = prisma,
): Promise<string | null> {
  const assets =
    researchSpec.analysisKind === 'panel'
      ? researchSpec.assets.map((asset) => asset.assetId)
      : researchSpec.assets;
  const [etfCutoff, commodityCarryCutoff, warehouseReceiptCutoff] = await Promise.all([
    resolveEtfCommonLatest(assets, database),
    requirements.commodityCarry
      ? resolveCommodityFutureCommonLatest(assets, database)
      : Promise.resolve(null),
    requirements.commodityWarehouseReceipts
      ? resolveCommodityWarehouseReceiptCommonLatest(assets, database)
      : Promise.resolve(null),
  ]);
  if (
    !etfCutoff ||
    (requirements.commodityCarry && !commodityCarryCutoff) ||
    (requirements.commodityWarehouseReceipts && !warehouseReceiptCutoff)
  ) {
    return null;
  }

  const availableCutoff = [etfCutoff, commodityCarryCutoff, warehouseReceiptCutoff]
    .filter((date): date is string => date !== null)
    .sort()[0];
  const requestedCutoff = researchSpec.dataPolicy.dataCutoff;
  if (!availableCutoff || (requestedCutoff && requestedCutoff > availableCutoff)) {
    return null;
  }
  return requestedCutoff ?? availableCutoff;
}

export async function resolveEtfCommonLatest(
  assets: string[],
  database: Prisma = prisma,
): Promise<string | null> {
  const latestRows = await database.etfDaily.groupBy({
    by: ['tsCode'],
    where: { tsCode: { in: assets }, close: { not: null } },
    _max: { tradeDate: true },
  });
  if (latestRows.length !== assets.length) {
    return null;
  }
  return (
    latestRows
      .map((row) => row._max.tradeDate)
      .filter((tradeDate): tradeDate is string => tradeDate !== null)
      .sort()[0] ?? null
  );
}

/**
 * 计算商品实际合约相关数据的共同最新日期，供研究范围冻结。
 *
 * Resolve the latest common date across required actual-contract commodity data.
 */
async function resolveCommodityFutureCommonLatest(
  assets: string[],
  database: Prisma,
): Promise<string | null> {
  const productCodes = commodityFutureProductCodesForEtfs(assets);
  if (!productCodes) {
    return null;
  }
  const contracts = await database.futureContract.findMany({
    where: { productCode: { in: productCodes } },
    select: { tsCode: true, productCode: true },
  });
  const productByContract = new Map(contracts.map((row) => [row.tsCode, row.productCode]));
  const latestRows = await database.futureDaily.groupBy({
    by: ['tsCode'],
    where: { tsCode: { in: contracts.map((row) => row.tsCode) }, settle: { not: null } },
    _max: { tradeDate: true },
  });
  const latestByProduct = new Map<string, string>();
  for (const row of latestRows) {
    const productCode = productByContract.get(row.tsCode);
    const tradeDate = row._max.tradeDate;
    if (productCode && tradeDate && tradeDate > (latestByProduct.get(productCode) ?? '')) {
      latestByProduct.set(productCode, tradeDate);
    }
  }
  const latestDates = productCodes
    .map((productCode) => latestByProduct.get(productCode))
    .filter((date): date is string => date !== undefined);
  return latestDates.length === productCodes.length ? (latestDates.sort()[0] ?? null) : null;
}

/**
 * 计算仓单与 ETF 目标的共同最新可得日期。
 *
 * Resolve the common latest available receipt and ETF target date.
 */
async function resolveCommodityWarehouseReceiptCommonLatest(
  assets: string[],
  database: Prisma,
): Promise<string | null> {
  const productCodes = commodityWarehouseReceiptProductCodesForEtfs(assets);
  if (!productCodes) {
    return null;
  }
  const latestRows = await database.commodityWarehouseReceipt.groupBy({
    by: ['productCode'],
    where: { productCode: { in: productCodes } },
    _max: { availableDate: true },
  });
  const latestByProduct = new Map(
    latestRows.flatMap((row) =>
      row._max.availableDate ? [[row.productCode, row._max.availableDate] as const] : [],
    ),
  );
  const latestDates = productCodes
    .map((productCode) => latestByProduct.get(productCode))
    .filter((date): date is string => date !== undefined);
  return latestDates.length === productCodes.length ? (latestDates.sort()[0] ?? null) : null;
}
