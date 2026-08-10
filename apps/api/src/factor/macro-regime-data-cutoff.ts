import type { FactorResearchSpecV1 } from '@jixie/shared';
import { prisma, type Prisma } from '../lib/prisma.js';

export async function resolveMacroRegimeDataCutoff(
  researchSpec: Extract<FactorResearchSpecV1, { analysisKind: 'macro_regime' }>,
  database: Prisma = prisma,
): Promise<string | null> {
  const [latestMacro, latestAssets] = await Promise.all([
    database.macroObservation.aggregate({ _max: { vintageDate: true } }),
    database.etfDaily.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: researchSpec.targetAssets }, close: { not: null } },
      _max: { tradeDate: true },
    }),
  ]);
  const macroCutoff = latestMacro._max.vintageDate;
  const assetCutoffs = latestAssets
    .map((row) => row._max.tradeDate)
    .filter((tradeDate): tradeDate is string => tradeDate !== null);
  if (!macroCutoff || assetCutoffs.length !== researchSpec.targetAssets.length) {
    return null;
  }

  // Macro vintages are capture/revision dates while ETF cutoffs are market dates. They do not
  // share a common trading calendar, so taking the earliest source date can censor a legitimate
  // latest-vintage macro snapshot merely because one ETF last traded earlier. Freeze the report at
  // the latest observed source date; each loader still enforces its own availability and horizon.
  const availableCutoff = [macroCutoff, ...assetCutoffs].sort().at(-1)!;
  const requestedCutoff = researchSpec.dataPolicy.dataCutoff;
  if (requestedCutoff && requestedCutoff > availableCutoff) {
    return null;
  }

  return requestedCutoff ?? availableCutoff;
}
