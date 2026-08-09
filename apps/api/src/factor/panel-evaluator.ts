import type {
  FactorPanelAssetClassReportV1,
  FactorPanelPeriodReportV1,
  FactorPanelReportV1,
  MultiAssetClass,
  PanelFactorResearchSpecV1,
} from '@jixie/shared';
import { annualizedReturn, mean, median, spearman, std } from '../lib/stats.js';

export interface PanelEvaluationObservation {
  assetId: string;
  assetClass: MultiAssetClass;
  asOfDate: string;
  featureAvailableDate: string;
  targetDate: string;
  score: number;
  forwardReturn: number;
  volatility: number;
}

interface WeightedAsset extends PanelEvaluationObservation {
  weight: number;
}

interface PeriodPortfolio {
  report: FactorPanelPeriodReportV1;
  weights: Map<string, number>;
  betweenClassWeights: Map<string, number>;
  betweenClassLongShortNetReturn: number;
  betweenClassOneWayTurnover: number;
  top: PanelEvaluationObservation[];
  bottom: PanelEvaluationObservation[];
}

export class PanelEvaluator {
  public readonly analysisKind = 'panel' as const;

  public evaluate(
    researchSpec: PanelFactorResearchSpecV1,
    observations: PanelEvaluationObservation[],
  ): FactorPanelReportV1 {
    const validated = validateObservations(researchSpec, observations);
    const observationsByDate = groupByDate(validated);
    const eligibleCounts = [...observationsByDate.values()].map((rows) => rows.length);
    const periodPortfolios: PeriodPortfolio[] = [];
    let previousWeights = new Map<string, number>();
    let previousBetweenClassWeights = new Map<string, number>();
    let skippedPeriods = 0;

    for (const [asOfDate, rows] of observationsByDate) {
      if (rows.length < researchSpec.minimumAssetsPerPeriod) {
        skippedPeriods++;
        continue;
      }
      const portfolio = buildPeriodPortfolio(
        researchSpec,
        asOfDate,
        rows,
        previousWeights,
        previousBetweenClassWeights,
      );
      periodPortfolios.push(portfolio);
      previousWeights = portfolio.weights;
      previousBetweenClassWeights = portfolio.betweenClassWeights;
    }
    if (periodPortfolios.length < 3) {
      throw new Error('Panel evaluation requires at least 3 eligible periods.');
    }

    const periodReports = periodPortfolios.map((portfolio) => portfolio.report);
    const rankIcs = periodReports.map((period) => period.rankIc);
    const periodsPerYear = periodsPerYearFor(researchSpec.observationFrequency);
    return {
      assets: researchSpec.assets.map((asset) => ({ ...asset })),
      periods: periodReports.length,
      observations: validated.length,
      skippedPeriods,
      coverage: {
        minimumAssets: Math.min(...eligibleCounts),
        medianAssets: median(eligibleCounts),
        maximumAssets: Math.max(...eligibleCounts),
        byAsset: researchSpec.assets.map((asset) => {
          const assetRows = validated.filter((row) => row.assetId === asset.assetId);
          return {
            ...asset,
            observations: assetRows.length,
            firstAsOfDate: assetRows.at(0)?.asOfDate ?? null,
            lastAsOfDate: assetRows.at(-1)?.asOfDate ?? null,
          };
        }),
      },
      rankIcMean: mean(rankIcs),
      rankIcirAnnual:
        rankIcs.length > 1 && std(rankIcs) > 0
          ? (mean(rankIcs) / std(rankIcs)) * Math.sqrt(periodsPerYear)
          : 0,
      rankIcPositiveRate: rankIcs.filter((rankIc) => rankIc > 0).length / rankIcs.length,
      equalWeightAnnualized: annualizedReturn(
        periodReports.map((period) => period.equalWeightReturn),
        periodsPerYear,
      ),
      topAnnualized: annualizedReturn(
        periodReports.map((period) => period.topReturn),
        periodsPerYear,
      ),
      bottomAnnualized: annualizedReturn(
        periodReports.map((period) => period.bottomReturn),
        periodsPerYear,
      ),
      longShortGrossAnnualized: annualizedReturn(
        periodReports.map((period) => period.longShortGrossReturn),
        periodsPerYear,
      ),
      longShortNetAnnualized: annualizedReturn(
        periodReports.map((period) => period.longShortNetReturn),
        periodsPerYear,
      ),
      averageOneWayTurnover: mean(periodReports.map((period) => period.oneWayTurnover)),
      byAssetClass: summarizeAssetClasses(researchSpec, validated, periodPortfolios),
      normalizationDiagnostics: buildNormalizationDiagnostics(
        validated,
        periodPortfolios,
        periodsPerYear,
      ),
      periodReports,
    };
  }
}

function validateObservations(
  researchSpec: PanelFactorResearchSpecV1,
  observations: PanelEvaluationObservation[],
): PanelEvaluationObservation[] {
  const declaredAssets = new Map(
    researchSpec.assets.map((asset) => [asset.assetId, asset.assetClass]),
  );
  const seen = new Set<string>();
  const validated = observations
    .map((observation) => ({ ...observation }))
    .sort(
      (left, right) =>
        left.asOfDate.localeCompare(right.asOfDate) || left.assetId.localeCompare(right.assetId),
    );

  for (const observation of validated) {
    if (declaredAssets.get(observation.assetId) !== observation.assetClass) {
      throw new Error(`Panel observation uses undeclared asset or class ${observation.assetId}.`);
    }
    if (
      !Number.isFinite(observation.score) ||
      !Number.isFinite(observation.forwardReturn) ||
      !Number.isFinite(observation.volatility) ||
      observation.volatility <= 0
    ) {
      throw new Error(
        'Panel observations require finite scores, returns, and positive volatility.',
      );
    }
    if (
      !/^\d{8}$/.test(observation.asOfDate) ||
      !/^\d{8}$/.test(observation.featureAvailableDate) ||
      !/^\d{8}$/.test(observation.targetDate)
    ) {
      throw new Error('Panel observation dates must use YYYYMMDD.');
    }
    if (observation.asOfDate < researchSpec.start || observation.asOfDate > researchSpec.end) {
      throw new Error(`Panel observation ${observation.asOfDate} is outside the research window.`);
    }
    if (observation.featureAvailableDate > observation.asOfDate) {
      throw new Error('Panel feature availability would introduce look-ahead bias.');
    }
    if (observation.targetDate <= observation.asOfDate) {
      throw new Error('Panel forward-return target must end after the as-of date.');
    }
    if (
      researchSpec.dataPolicy.dataCutoff &&
      observation.targetDate > researchSpec.dataPolicy.dataCutoff
    ) {
      throw new Error('Panel forward-return target extends beyond the frozen data cutoff.');
    }
    const identity = `${observation.asOfDate}:${observation.assetId}`;
    if (seen.has(identity)) {
      throw new Error(`Duplicate panel observation ${identity}.`);
    }
    seen.add(identity);
  }

  for (const rows of groupByDate(validated).values()) {
    if (new Set(rows.map((row) => row.targetDate)).size !== 1) {
      throw new Error(`Panel period ${rows[0].asOfDate} must use one common target date.`);
    }
  }
  return validated;
}

function groupByDate(
  observations: PanelEvaluationObservation[],
): Map<string, PanelEvaluationObservation[]> {
  const result = new Map<string, PanelEvaluationObservation[]>();
  for (const observation of observations) {
    const rows = result.get(observation.asOfDate) ?? [];
    rows.push(observation);
    result.set(observation.asOfDate, rows);
  }
  return result;
}

function buildPeriodPortfolio(
  researchSpec: PanelFactorResearchSpecV1,
  asOfDate: string,
  rows: PanelEvaluationObservation[],
  previousWeights: Map<string, number>,
  previousBetweenClassWeights: Map<string, number>,
): PeriodPortfolio {
  const ranked = [...rows].sort(
    (left, right) => right.score - left.score || left.assetId.localeCompare(right.assetId),
  );
  const topCount = Math.max(1, Math.floor(rows.length * researchSpec.portfolio.topFraction));
  const bottomCount = Math.min(
    Math.max(1, Math.floor(rows.length * researchSpec.portfolio.bottomFraction)),
    rows.length - topCount,
  );
  const top = ranked.slice(0, topCount);
  const bottom = ranked.slice(-bottomCount);
  const weightedTop = legWeights(top, 0.5, researchSpec.volatilityScaling);
  const weightedBottom = legWeights(bottom, -0.5, researchSpec.volatilityScaling);
  const weights = new Map(
    [...weightedTop, ...weightedBottom].map((observation) => [
      observation.assetId,
      observation.weight,
    ]),
  );
  const betweenClassLegs = buildBetweenClassLegs(rows, researchSpec);
  const betweenClassWeights = new Map(
    [...betweenClassLegs.top, ...betweenClassLegs.bottom].map((observation) => [
      observation.assetId,
      observation.weight,
    ]),
  );
  const oneWayTurnover = portfolioTurnover(previousWeights, weights);
  const betweenClassOneWayTurnover = portfolioTurnover(
    previousBetweenClassWeights,
    betweenClassWeights,
  );
  const topReturn = weightedReturn(weightedTop, 0.5);
  const bottomReturn = weightedReturn(weightedBottom, -0.5);
  const longShortGrossReturn = topReturn - bottomReturn;
  const transactionCost = oneWayTurnover * 2 * researchSpec.portfolio.transactionCostPerSide;
  const betweenClassLongShortGrossReturn =
    weightedReturn(betweenClassLegs.top, 0.5) - weightedReturn(betweenClassLegs.bottom, -0.5);
  const betweenClassTransactionCost =
    betweenClassOneWayTurnover * 2 * researchSpec.portfolio.transactionCostPerSide;

  return {
    weights,
    betweenClassWeights,
    betweenClassLongShortNetReturn: betweenClassLongShortGrossReturn - betweenClassTransactionCost,
    betweenClassOneWayTurnover,
    top,
    bottom,
    report: {
      asOfDate,
      targetDate: rows[0].targetDate,
      eligibleAssets: rows.length,
      rankIc: spearman(
        rows.map((row) => row.score),
        rows.map((row) => row.forwardReturn),
      ),
      equalWeightReturn: mean(rows.map((row) => row.forwardReturn)),
      topReturn,
      bottomReturn,
      longShortGrossReturn,
      longShortNetReturn: longShortGrossReturn - transactionCost,
      oneWayTurnover,
    },
  };
}

function buildBetweenClassLegs(
  observations: PanelEvaluationObservation[],
  researchSpec: PanelFactorResearchSpecV1,
): { top: WeightedAsset[]; bottom: WeightedAsset[] } {
  const byClass = new Map<MultiAssetClass, PanelEvaluationObservation[]>();
  for (const observation of observations) {
    const rows = byClass.get(observation.assetClass) ?? [];
    rows.push(observation);
    byClass.set(observation.assetClass, rows);
  }
  const rankedClasses = [...byClass.values()].sort(
    (left, right) =>
      mean(right.map((row) => row.score)) - mean(left.map((row) => row.score)) ||
      left[0].assetClass.localeCompare(right[0].assetClass),
  );
  const topCount = Math.max(
    1,
    Math.floor(rankedClasses.length * researchSpec.portfolio.topFraction),
  );
  const bottomCount = Math.min(
    Math.max(1, Math.floor(rankedClasses.length * researchSpec.portfolio.bottomFraction)),
    rankedClasses.length - topCount,
  );
  const selectedTop = rankedClasses.slice(0, topCount);
  const selectedBottom = rankedClasses.slice(-bottomCount);
  return {
    top: selectedTop.flatMap((rows) =>
      legWeights(rows, 0.5 / selectedTop.length, researchSpec.volatilityScaling),
    ),
    bottom: selectedBottom.flatMap((rows) =>
      legWeights(rows, -0.5 / selectedBottom.length, researchSpec.volatilityScaling),
    ),
  };
}

function legWeights(
  observations: PanelEvaluationObservation[],
  grossWeight: number,
  volatilityScaling: PanelFactorResearchSpecV1['volatilityScaling'],
): WeightedAsset[] {
  const rawWeights = observations.map((observation) =>
    volatilityScaling === 'inverse_volatility' ? 1 / observation.volatility : 1,
  );
  const total = rawWeights.reduce((sum, weight) => sum + weight, 0);
  return observations.map((observation, index) => ({
    ...observation,
    weight: (rawWeights[index] / total) * grossWeight,
  }));
}

function weightedReturn(observations: WeightedAsset[], grossWeight: number): number {
  return (
    observations.reduce(
      (sum, observation) => sum + observation.forwardReturn * observation.weight,
      0,
    ) / grossWeight
  );
}

function portfolioTurnover(
  previousWeights: Map<string, number>,
  currentWeights: Map<string, number>,
): number {
  const assets = new Set([...previousWeights.keys(), ...currentWeights.keys()]);
  const absoluteChanges = [...assets].reduce(
    (sum, assetId) =>
      sum + Math.abs((currentWeights.get(assetId) ?? 0) - (previousWeights.get(assetId) ?? 0)),
    0,
  );
  return absoluteChanges / 2;
}

function summarizeAssetClasses(
  researchSpec: PanelFactorResearchSpecV1,
  observations: PanelEvaluationObservation[],
  portfolios: PeriodPortfolio[],
): FactorPanelAssetClassReportV1[] {
  const classes = [...new Set(researchSpec.assets.map((asset) => asset.assetClass))];
  return classes.map((assetClass) => {
    const classObservations = observations.filter(
      (observation) => observation.assetClass === assetClass,
    );
    return {
      assetClass,
      observations: classObservations.length,
      meanForwardReturn: mean(classObservations.map((observation) => observation.forwardReturn)),
      topSelections: portfolios.reduce(
        (count, portfolio) =>
          count +
          portfolio.top.filter((observation) => observation.assetClass === assetClass).length,
        0,
      ),
      bottomSelections: portfolios.reduce(
        (count, portfolio) =>
          count +
          portfolio.bottom.filter((observation) => observation.assetClass === assetClass).length,
        0,
      ),
    };
  });
}

function buildNormalizationDiagnostics(
  observations: PanelEvaluationObservation[],
  portfolios: PeriodPortfolio[],
  periodsPerYear: number,
): FactorPanelReportV1['normalizationDiagnostics'] {
  const withinClassRankIcs: number[] = [];
  const betweenClassRankIcs: number[] = [];
  for (const rows of groupByDate(observations).values()) {
    const byClass = new Map<MultiAssetClass, PanelEvaluationObservation[]>();
    for (const row of rows) {
      const classRows = byClass.get(row.assetClass) ?? [];
      classRows.push(row);
      byClass.set(row.assetClass, classRows);
    }
    for (const classRows of byClass.values()) {
      if (classRows.length >= 2) {
        withinClassRankIcs.push(
          spearman(
            classRows.map((row) => row.score),
            classRows.map((row) => row.forwardReturn),
          ),
        );
      }
    }
    if (byClass.size >= 2) {
      const classRows = [...byClass.values()];
      betweenClassRankIcs.push(
        spearman(
          classRows.map((members) => mean(members.map((row) => row.score))),
          classRows.map((members) => mean(members.map((row) => row.forwardReturn))),
        ),
      );
    }
  }
  return {
    withinClassRankIcMean: withinClassRankIcs.length ? mean(withinClassRankIcs) : null,
    withinClassComparisons: withinClassRankIcs.length,
    betweenClassRankIcMean: betweenClassRankIcs.length ? mean(betweenClassRankIcs) : null,
    betweenClassPeriods: betweenClassRankIcs.length,
    betweenClassLongShortNetAnnualized: annualizedReturn(
      portfolios.map((portfolio) => portfolio.betweenClassLongShortNetReturn),
      periodsPerYear,
    ),
    betweenClassAverageOneWayTurnover: mean(
      portfolios.map((portfolio) => portfolio.betweenClassOneWayTurnover),
    ),
  };
}

function periodsPerYearFor(frequency: PanelFactorResearchSpecV1['observationFrequency']): number {
  return { daily: 252, weekly: 52, monthly: 12 }[frequency];
}
