import type { MultiAssetClass, PanelFactorResearchSpecV1 } from '@jixie/shared';
import { addDays } from '../lib/date.js';
import { prisma } from '../lib/prisma.js';
import type { CompiledPanelFactor } from './compile-time-series-factor.js';
import type { PanelEvaluationObservation } from './panel-evaluator.js';

export interface PanelEtfDailyRow {
  assetId: string;
  tradeDate: string;
  close: number;
  adjustmentFactor: number;
}

export interface PanelEtfMetadata {
  assetId: string;
  name: string;
  indexCode: string | null;
  indexName: string | null;
  fundType: string | null;
  etfType: string | null;
}

export async function loadPanelEtfObservations(
  researchSpec: PanelFactorResearchSpecV1,
  factor: CompiledPanelFactor,
): Promise<PanelEvaluationObservation[]> {
  assertSupportedProtocol(researchSpec, factor);
  const assetIds = researchSpec.assets.map((asset) => asset.assetId);
  const historyStart = addDays(researchSpec.start, -(Math.max(factor.window, 21) + 10) * 3);
  const targetEnd = addDays(researchSpec.end, (researchSpec.target.horizon + 10) * 3);
  const upperBound = researchSpec.dataPolicy.dataCutoff
    ? researchSpec.dataPolicy.dataCutoff < targetEnd
      ? researchSpec.dataPolicy.dataCutoff
      : targetEnd
    : targetEnd;
  const [bars, adjustments, calendar, metadata] = await Promise.all([
    prisma.etfDaily.findMany({
      where: {
        tsCode: { in: assetIds },
        tradeDate: { gte: historyStart, lte: upperBound },
        close: { not: null },
      },
      select: { tsCode: true, tradeDate: true, close: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    }),
    prisma.etfAdjFactor.findMany({
      where: {
        tsCode: { in: assetIds },
        tradeDate: { gte: historyStart, lte: upperBound },
      },
      select: { tsCode: true, tradeDate: true, adjFactor: true },
    }),
    prisma.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gte: historyStart, lte: upperBound },
      },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    }),
    prisma.etfBasic.findMany({
      where: { tsCode: { in: assetIds } },
      select: {
        tsCode: true,
        name: true,
        indexCode: true,
        indexName: true,
        fundType: true,
        etfType: true,
      },
    }),
  ]);
  const declaredClasses = new Map(
    researchSpec.assets.map((asset) => [asset.assetId, asset.assetClass]),
  );
  if (metadata.length !== assetIds.length) {
    throw new Error('Panel research requires metadata for every declared ETF.');
  }
  for (const asset of metadata) {
    const metadataRow: PanelEtfMetadata = {
      assetId: asset.tsCode,
      name: asset.name,
      indexCode: asset.indexCode,
      indexName: asset.indexName,
      fundType: asset.fundType,
      etfType: asset.etfType,
    };
    const expectedClass = declaredClasses.get(asset.tsCode)!;
    if (!panelEtfMatchesAssetClass(metadataRow, expectedClass)) {
      throw new Error(`ETF ${asset.tsCode} does not match declared asset class ${expectedClass}.`);
    }
  }

  const adjustmentByAssetDate = new Map(
    adjustments.map((row) => [`${row.tsCode}:${row.tradeDate}`, row.adjFactor]),
  );
  return buildPanelEtfObservations(
    researchSpec,
    bars.map((bar) => ({
      assetId: bar.tsCode,
      tradeDate: bar.tradeDate,
      close: bar.close!,
      adjustmentFactor: adjustmentByAssetDate.get(`${bar.tsCode}:${bar.tradeDate}`) ?? Number.NaN,
    })),
    calendar.map((row) => row.calDate),
    factor,
  );
}

export async function buildPanelEtfObservations(
  researchSpec: PanelFactorResearchSpecV1,
  rows: PanelEtfDailyRow[],
  openDates: string[],
  factor: CompiledPanelFactor,
): Promise<PanelEvaluationObservation[]> {
  assertSupportedProtocol(researchSpec, factor);
  const declaredAssets = new Map(
    researchSpec.assets.map((asset) => [asset.assetId, asset.assetClass]),
  );
  const calendar = validateCalendar(openDates);
  const decisionDates = monthlyDecisionDates(calendar, researchSpec.start, researchSpec.end);
  const calendarIndex = new Map(calendar.map((date, index) => [date, index]));
  const byAsset = new Map<string, PanelEtfDailyRow[]>();

  for (const row of rows) {
    if (!declaredAssets.has(row.assetId)) {
      throw new Error(`Panel ETF data uses undeclared asset ${row.assetId}.`);
    }
    if (
      !/^\d{8}$/.test(row.tradeDate) ||
      !Number.isFinite(row.close) ||
      row.close <= 0 ||
      !Number.isFinite(row.adjustmentFactor) ||
      row.adjustmentFactor <= 0
    ) {
      throw new Error(`Panel ETF data is incomplete for ${row.assetId} on ${row.tradeDate}.`);
    }
    const assetRows = byAsset.get(row.assetId) ?? [];
    assetRows.push({ ...row });
    byAsset.set(row.assetId, assetRows);
  }

  const observations: PanelEvaluationObservation[] = [];
  for (const { assetId, assetClass } of researchSpec.assets) {
    const assetRows = (byAsset.get(assetId) ?? []).sort((left, right) =>
      left.tradeDate.localeCompare(right.tradeDate),
    );
    const dateIndex = new Map<string, number>();
    for (let index = 0; index < assetRows.length; index++) {
      const date = assetRows[index].tradeDate;
      if (dateIndex.has(date)) {
        throw new Error(`Duplicate panel ETF bar ${assetId}:${date}.`);
      }
      dateIndex.set(date, index);
    }
    const adjustedCloses = assetRows.map((row) => row.close * row.adjustmentFactor);
    const scoreIndexes: number[] = [];
    const eligibleDates: Array<{ asOfDate: string; targetDate: string; index: number }> = [];
    for (const asOfDate of decisionDates) {
      const targetDate = calendar[calendarIndex.get(asOfDate)! + researchSpec.target.horizon];
      if (
        !targetDate ||
        (researchSpec.dataPolicy.dataCutoff && targetDate > researchSpec.dataPolicy.dataCutoff)
      ) {
        continue;
      }
      const index = dateIndex.get(asOfDate);
      const targetIndex = dateIndex.get(targetDate);
      if (
        index == null ||
        targetIndex == null ||
        index < factor.window - 1 ||
        index < 20 ||
        targetIndex <= index
      ) {
        continue;
      }
      scoreIndexes.push(index);
      eligibleDates.push({ asOfDate, targetDate, index });
    }
    const scores = await factor.computeSeries(
      { 'etf.adjustedClose': adjustedCloses },
      scoreIndexes,
    );
    if (scores.length !== eligibleDates.length) {
      throw new Error(
        `Panel factor returned ${scores.length} scores for ${eligibleDates.length} observations.`,
      );
    }
    for (let position = 0; position < eligibleDates.length; position++) {
      const score = scores[position];
      if (score == null) {
        continue;
      }
      const { asOfDate, targetDate, index } = eligibleDates[position];
      const targetIndex = dateIndex.get(targetDate)!;
      observations.push({
        assetId,
        assetClass,
        asOfDate,
        featureAvailableDate: asOfDate,
        targetDate,
        score,
        forwardReturn: adjustedCloses[targetIndex] / adjustedCloses[index] - 1,
        volatility: trailingVolatility(adjustedCloses, index, 20),
      });
    }
  }
  return observations.sort(
    (left, right) =>
      left.asOfDate.localeCompare(right.asOfDate) || left.assetId.localeCompare(right.assetId),
  );
}

export function panelEtfMatchesAssetClass(
  metadata: PanelEtfMetadata,
  assetClass: MultiAssetClass,
): boolean {
  const description = `${metadata.name} ${metadata.indexName ?? ''}`;
  switch (assetClass) {
    case 'cn_equity':
      return metadata.fundType === '股票型' && metadata.etfType !== 'QDII';
    case 'overseas_equity':
      return metadata.fundType === '股票型' && metadata.etfType === 'QDII';
    case 'fixed_income':
      return metadata.fundType === '债券型';
    case 'gold':
      return /黄金/.test(description) || /^Au/i.test(metadata.indexCode ?? '');
    case 'commodity':
      return /期货/.test(description) && !/黄金/.test(description);
  }
}

function assertSupportedProtocol(
  researchSpec: PanelFactorResearchSpecV1,
  factor: CompiledPanelFactor,
): void {
  if (
    researchSpec.observationFrequency !== 'monthly' ||
    researchSpec.target.horizonUnit !== 'trade_day'
  ) {
    throw new Error('Panel ETF observations currently require monthly trade-day horizons.');
  }
  if (
    factor.analysisKind !== 'panel' ||
    factor.outputScope !== 'asset' ||
    factor.frequency !== 'daily' ||
    factor.inputs.length !== 1 ||
    factor.inputs[0] !== 'etf.adjustedClose'
  ) {
    throw new Error(
      'Panel ETF observations require a price-only daily asset-scope Factor V2 definition.',
    );
  }
  const broadClass = (assetClass: MultiAssetClass) =>
    assetClass === 'cn_equity' || assetClass === 'overseas_equity'
      ? 'equity'
      : assetClass === 'fixed_income'
        ? 'fixed_income'
        : 'commodity';
  if (
    researchSpec.assets.some(
      (asset) => !factor.targetAssetClasses.includes(broadClass(asset.assetClass)),
    )
  ) {
    throw new Error('Panel Factor V2 target classes do not cover the declared ETF universe.');
  }
}

function validateCalendar(openDates: string[]): string[] {
  const calendar = [...openDates].sort();
  if (
    calendar.some((date) => !/^\d{8}$/.test(date)) ||
    new Set(calendar).size !== calendar.length
  ) {
    throw new Error('Panel trading calendar is invalid.');
  }
  return calendar;
}

function monthlyDecisionDates(calendar: string[], start: string, end: string): string[] {
  const byMonth = new Map<string, string>();
  for (const date of calendar) {
    if (date >= start && date <= end) {
      byMonth.set(date.slice(0, 6), date);
    }
  }
  return [...byMonth.values()];
}

function trailingVolatility(values: number[], index: number, periods: number): number {
  const returns: number[] = [];
  for (let position = index - periods + 1; position <= index; position++) {
    returns.push(values[position] / values[position - 1] - 1);
  }
  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    Math.max(1, returns.length - 1);
  return Math.max(Math.sqrt(variance), Number.EPSILON);
}
