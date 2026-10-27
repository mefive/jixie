import type { FactorResearchSpecV1 } from '@jixie/shared';
import { getDatabase, type Prisma } from '#infra/database/prisma.js';

/**
 * 根据资产因子声明的输入数据集取共同可用截止日。
 *
 * Resolve the common available cutoff across an asset factor's declared datasets.
 */
export async function resolveAssetFactorDataCutoff(
  researchSpec: Extract<FactorResearchSpecV1, { analysisKind: 'time_series' | 'panel' }>,
  database: Prisma = getDatabase(),
): Promise<string | null> {
  const assets =
    researchSpec.analysisKind === 'panel'
      ? researchSpec.assets.map((asset) => asset.assetId)
      : researchSpec.assets;
  const availableCutoff = await resolveEtfCommonLatest(assets, database);
  const requestedCutoff = researchSpec.dataPolicy.dataCutoff;
  if (!availableCutoff || (requestedCutoff && requestedCutoff > availableCutoff)) {
    return null;
  }
  return requestedCutoff ?? availableCutoff;
}

export async function resolveEtfCommonLatest(
  assets: string[],
  database: Prisma = getDatabase(),
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
