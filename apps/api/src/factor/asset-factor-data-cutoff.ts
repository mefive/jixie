import type { FactorResearchSpecV1 } from '@jixie/shared';
import {
  commodityFutureProductCodesForEtfs,
  commodityWarehouseReceiptProductCodesForEtfs,
} from '../commodity/commodity-futures.js';
import { prisma, type Prisma } from '../lib/prisma.js';

export interface AssetFactorDataRequirements {
  commodityCarry?: boolean;
  commodityWarehouseReceipts?: boolean;
}

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
