import type { TimeSeriesEvaluationObservation } from './contract.js';
import type { TimeSeriesFactorSandbox } from '../sandbox/contract.js';
import type { TimeSeriesFactorResearchSpecV1 } from '@jixie/shared';
import { addDays } from '#date';
import { getDatabase } from '#infra/database/prisma.js';

import { type FactorV2FieldKey } from '../definitions/fields.js';

/**
 * 提供 ETF 趋势所需日线字段，供特征与收益构造。
 *
 * Supply ETF daily fields for trend features and returns.
 */
export interface EtfTrendDailyRow {
  assetId: string;
  tradeDate: string;
  close: number;
  adjustmentFactor: number;
}

/**
 * 加载 ETF 趋势研究的行情与利率输入，供时点观测构造。
 *
 * Load ETF price and yield inputs for trend-factor observations.
 */
export async function loadEtfTimeSeriesObservations(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  factor: TimeSeriesFactorSandbox,
): Promise<TimeSeriesEvaluationObservation[]> {
  assertSupportedProtocol(researchSpec, factor);
  const historyStart = addDays(
    researchSpec.start,
    -(factor.metadata.window - 1 + researchSpec.target.horizon) * 3,
  );
  const upperBound = researchSpec.dataPolicy.dataCutoff ?? undefined;
  const [bars, adjustments] = await Promise.all([
    getDatabase().etfDaily.findMany({
      where: {
        tsCode: { in: researchSpec.assets },
        tradeDate: { gte: historyStart, ...(upperBound ? { lte: upperBound } : {}) },
        close: { not: null },
      },
      select: { tsCode: true, tradeDate: true, close: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    }),
    getDatabase().etfAdjFactor.findMany({
      where: {
        tsCode: { in: researchSpec.assets },
        tradeDate: { gte: historyStart, ...(upperBound ? { lte: upperBound } : {}) },
      },
      select: { tsCode: true, tradeDate: true, adjFactor: true },
    }),
  ]);

  const adjustmentByAssetDate = new Map(
    adjustments.map((row) => [`${row.tsCode}:${row.tradeDate}`, row.adjFactor]),
  );
  return buildEtfTimeSeriesObservations(
    researchSpec,
    bars.map((bar) => ({
      assetId: bar.tsCode,
      tradeDate: bar.tradeDate,
      close: bar.close!,
      adjustmentFactor: adjustmentByAssetDate.get(`${bar.tsCode}:${bar.tradeDate}`) ?? Number.NaN,
    })),
    factor,
  );
}

/**
 * 按策略字段和窗口构造 ETF 趋势与前瞻收益观测。
 *
 * Build ETF trend features and forward-return observations under the declared windows.
 */
export async function buildEtfTimeSeriesObservations(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  rows: EtfTrendDailyRow[],
  factor: TimeSeriesFactorSandbox,
): Promise<TimeSeriesEvaluationObservation[]> {
  assertSupportedProtocol(researchSpec, factor);
  const declaredAssets = new Set(researchSpec.assets);
  const byAsset = new Map<string, EtfTrendDailyRow[]>();

  for (const row of rows) {
    if (!declaredAssets.has(row.assetId)) {
      throw new Error(`ETF trend data uses undeclared asset ${row.assetId}.`);
    }
    if (
      !/^\d{8}$/.test(row.tradeDate) ||
      !Number.isFinite(row.close) ||
      row.close <= 0 ||
      !Number.isFinite(row.adjustmentFactor) ||
      row.adjustmentFactor <= 0
    ) {
      throw new Error(`ETF trend data is incomplete for ${row.assetId} on ${row.tradeDate}.`);
    }
    const assetRows = byAsset.get(row.assetId) ?? [];
    assetRows.push({ ...row });
    byAsset.set(row.assetId, assetRows);
  }

  const observations: TimeSeriesEvaluationObservation[] = [];
  for (const assetId of researchSpec.assets) {
    const assetRows = (byAsset.get(assetId) ?? []).sort((left, right) =>
      left.tradeDate.localeCompare(right.tradeDate),
    );
    const seenDates = new Set<string>();
    for (const row of assetRows) {
      if (seenDates.has(row.tradeDate)) {
        throw new Error(`Duplicate ETF trend bar ${assetId}:${row.tradeDate}.`);
      }
      seenDates.add(row.tradeDate);
    }
    const adjustedCloses = assetRows.map((row) => row.close * row.adjustmentFactor);
    const { fields, availableDates } = alignedFactorFields(
      assetRows,
      adjustedCloses,
      factor.metadata.inputs,
    );
    const indexes: number[] = [];
    for (
      let index = factor.metadata.window - 1;
      index + researchSpec.target.horizon < assetRows.length;
      index++
    ) {
      const current = assetRows[index];
      const target = assetRows[index + researchSpec.target.horizon];
      if (current.tradeDate < researchSpec.start || current.tradeDate > researchSpec.end) {
        continue;
      }
      if (
        researchSpec.dataPolicy.dataCutoff &&
        target.tradeDate > researchSpec.dataPolicy.dataCutoff
      ) {
        continue;
      }
      indexes.push(index);
    }
    const scores = await factor.execute({ fields: fields, indexes: indexes });
    if (scores.length !== indexes.length) {
      throw new Error(
        `Time-series factor returned ${scores.length} scores for ${indexes.length} observations`,
      );
    }
    for (let position = 0; position < indexes.length; position++) {
      const score = scores[position];
      if (score == null) {
        continue;
      }
      const index = indexes[position];
      const current = assetRows[index];
      const target = assetRows[index + researchSpec.target.horizon];
      observations.push({
        assetId,
        asOfDate: current.tradeDate,
        featureAvailableDate: latestFeatureAvailableDate(
          factor.metadata.inputs,
          availableDates,
          index,
        ),
        targetDate: target.tradeDate,
        score,
        forwardReturn:
          adjustedCloses[index + researchSpec.target.horizon] / adjustedCloses[index] - 1,
      });
    }
  }
  return observations;
}

/**
 * 验证 ETF 趋势研究的窗口、目标和协议支持范围。
 *
 * Validate supported windows, targets and ETF trend protocols.
 */
function assertSupportedProtocol(
  researchSpec: TimeSeriesFactorResearchSpecV1,
  factor: TimeSeriesFactorSandbox,
): void {
  if (
    researchSpec.observationFrequency !== 'daily' ||
    researchSpec.target.horizonUnit !== 'trade_day'
  ) {
    throw new Error('ETF trend observations currently require daily trade-day horizons.');
  }
  if (
    factor.metadata.analysisKind !== 'time_series' ||
    factor.metadata.outputScope !== 'asset' ||
    factor.metadata.frequency !== 'daily' ||
    factor.metadata.inputs.length === 0
  ) {
    throw new Error('ETF observations require a daily asset-scope Factor V2 definition.');
  }
}

/**
 * 从已声明字段构造对齐历史，供作者因子读取。
 *
 * Build aligned field histories for authored factor reads.
 */
function alignedFactorFields(
  assetRows: EtfTrendDailyRow[],
  adjustedCloses: number[],
  inputs: FactorV2FieldKey[],
): {
  fields: Partial<Record<FactorV2FieldKey, number[]>>;
  availableDates: Partial<Record<FactorV2FieldKey, string[]>>;
} {
  const fields: Partial<Record<FactorV2FieldKey, number[]>> = {};
  const availableDates: Partial<Record<FactorV2FieldKey, string[]>> = {};
  if (inputs.includes('etf.adjustedClose')) {
    fields['etf.adjustedClose'] = adjustedCloses;
    availableDates['etf.adjustedClose'] = assetRows.map((row) => row.tradeDate);
  }
  return { fields, availableDates };
}

function latestFeatureAvailableDate(
  inputs: FactorV2FieldKey[],
  availableDates: Partial<Record<FactorV2FieldKey, string[]>>,
  index: number,
): string {
  const dates = inputs
    .map((input) => availableDates[input]?.[index])
    .filter((date): date is string => Boolean(date))
    .sort();
  if (dates.length !== inputs.length) {
    throw new Error('Factor produced a score with an unavailable point-in-time input.');
  }
  return dates.at(-1)!;
}
